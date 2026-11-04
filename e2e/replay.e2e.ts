// The presenter's path in docs/demo.md, steps 1 to 13, clicked through in a real browser against the
// built app in replay (#55). Each test starts its own server on emptied data, so every request the
// app's route handlers make must have a recording. A request with none fails the walk at once with
// the server's log line for it. It runs once per placement level: «لا أعرف بعد» three times as Omar's
// run answered (beginner), two right (intermediate) and all three right (advanced), each on its own
// level's recordings (#98). The quiz keys and the plan's lessons come from the session's files, since
// each level has its own. More tests leave the recorded path where replay keeps the learner on it
// with a note: their own words, wrong picks and another tone, at the beginner's level and another,
// and «استراحة أسبوع» at the check-in. One finishes the beginner chase, confirms «إعادة», starts an
// intermediate interview, and checks that the clock is «يوم البدء» with an empty feed (#119).
// Selectors use roles and the app's own words, never banner wording; the borrowed-level note and
// swap event are matched by text on purpose, the replay notes by their role.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import type { LearnerProfile } from "../contracts/index.ts";
import { demoServer } from "../demo/run.ts";
import { DEMO_SESSION_ID } from "../demo/session.ts";
import { DONT_KNOW } from "../src/server/agents/intake/diagnostic.ts";

type Level = LearnerProfile["diagnostic"]["level"];

const NEXT = join(process.cwd(), "node_modules/next/dist/bin/next");
const FIRST_PORT = Number(process.env.E2E_PORT ?? 3190);

type Replay = { url: string; data: string; log: string };

// The server's lines for model requests replay had no recording for.
const missingRecordings = ({ log }: Replay) =>
  readFileSync(log, "utf8").match(/\[replay\] No recorded response.*/g) ?? [];

const test = base.extend<{ replay: Replay }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a fixture uses from its first argument
  replay: async ({}, use, testInfo) => {
    if (!existsSync(".next/BUILD_ID")) throw new Error("No build to serve: run `pnpm build` first");
    const dir = mkdtempSync(join(tmpdir(), "e2e-replay-"));
    const replay = {
      url: `http://127.0.0.1:${FIRST_PORT + testInfo.parallelIndex}`,
      data: join(dir, "data"),
      log: join(dir, "server.log"),
    };
    const out = openSync(replay.log, "w");
    // The settings of `pnpm preview` (replay, unpaced, the recorded topic) on this test's own data
    // and port. A local .env cannot hide the demo bar or swap the notifier.
    const env = {
      ...process.env,
      ...demoServer("preview", {}).env,
      DATA_DIR: replay.data,
      SIM_CLOCK: "true",
      NOTIFIER_ADAPTER: "simulated",
      NODE_ENV: "production",
    } as const;
    const server = spawn(
      process.execPath,
      [NEXT, "start", "-H", "127.0.0.1", "-p", new URL(replay.url).port],
      { env, stdio: ["ignore", out, out] },
    );
    try {
      for (let tries = 0; ; tries++) {
        if (server.exitCode !== null) throw new Error(`The server exited (${server.exitCode})`);
        if (tries === 120) throw new Error("The server did not answer within 30 s");
        const up = await fetch(`${replay.url}/api/sessions/${DEMO_SESSION_ID}/trace`).catch(
          () => null,
        );
        if (up?.ok) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await use(replay);
    } finally {
      // A graceful stop would wait for the page's trace stream, which stays open until the page goes.
      server.kill("SIGKILL");
      if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
      // Copied into the test's output folder, where a failed test also keeps its Playwright trace.
      await testInfo.attach("server.log", { path: replay.log });
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

// Waits for `target`, and fails at once with the server's line when replay had no recording.
async function see(replay: Replay, target: Locator, timeout = 120_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    expect(missingRecordings(replay), "requests replay has no recording for").toEqual([]);
    if (await target.isVisible()) return;
    await target.page().waitForTimeout(250);
  }
  await expect(target).toBeVisible({ timeout: 1 });
}

// Waits until `target` is gone, and fails at once with the server's line when replay had no
// recording.
async function gone(replay: Replay, target: Locator, timeout = 120_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    expect(missingRecordings(replay), "requests replay has no recording for").toEqual([]);
    if ((await target.count()) === 0) return;
    await target.page().waitForTimeout(250);
  }
  await expect(target).toHaveCount(0, { timeout: 1 });
}

// Resolves once the browser has posted to an API path ending in `path` and the server said yes.
async function posted(page: Page, path: RegExp, act: () => Promise<void>) {
  const answer = page.waitForResponse(
    (r) => r.request().method() === "POST" && path.test(new URL(r.url()).pathname),
  );
  await act();
  expect((await answer).status(), `POST ${path}`).toBeLessThan(300);
}

// Fails at once with the server's line when replay had no recording, then checks the trace the
// drawer reads: no model call and no page without a recording. Returns the trace's events.
async function noneMissing(page: Page, replay: Replay) {
  expect(missingRecordings(replay), "requests replay has no recording for").toEqual([]);
  const trace = await page.request.get(`${replay.url}/api/sessions/${DEMO_SESSION_ID}/trace`);
  const { events } = (await trace.json()) as {
    events: { kind: string; missing_recording?: string; summary_en: string }[];
  };
  expect(events.filter((e) => e.missing_recording)).toEqual([]);
  expect(events.filter((e) => e.summary_en.includes("No recorded page"))).toEqual([]);
  return events;
}

// The session's data as the server saved it.
const savedDoc = <T>(replay: Replay, name: string): T =>
  JSON.parse(readFileSync(join(replay.data, "sessions", DEMO_SESSION_ID, `${name}.json`), "utf8"));

type Question = { id: string; options_ar: string[]; answer: string };
type Quiz = { id: string; lesson_id: string; items: (Question & { type: "mcq" | "short" })[] };

// The lesson's latest quiz, with its keys, as the server saved it.
function latestQuiz(replay: Replay, lessonId: string): Quiz {
  const { quizzes } = savedDoc<{ quizzes: Quiz[] }>(replay, "quizzes");
  const quiz = quizzes.filter((q) => q.lesson_id === lessonId).at(-1);
  if (!quiz) throw new Error(`No quiz saved for lesson ${lessonId}`);
  return quiz;
}

// An option other than the key.
const wrongOption = (q: Question) => q.options_ar.find((o) => o !== q.answer) ?? "";

// Answers the lesson's latest quiz from its keys, with another option on the multiple-choice items
// at the places `wrong` gives among them, and `shorts` in the short items' boxes or else their
// recorded chips, then hands it in.
async function takeQuiz(
  page: Page,
  replay: Replay,
  lessonId: string,
  { wrong = [], shorts }: { wrong?: number[]; shorts?: string[] } = {},
) {
  await see(replay, page.getByRole("button", { name: "سلّم الإجابات" }));
  const quiz = latestQuiz(replay, lessonId);
  const choices = quiz.items.filter((item) => item.type === "mcq");
  for (const [i, item] of choices.entries()) {
    await page
      .locator(`[id="q-${item.id}"]`)
      .getByRole("radio", {
        name: wrong.includes(i) ? wrongOption(item) : item.answer,
        exact: true,
      })
      .check();
  }
  if (shorts) {
    const boxes = page.getByRole("textbox");
    for (const [i, text] of shorts.entries()) await boxes.nth(i).fill(text);
  } else {
    const chip = page.getByRole("button", { name: "املأ الإجابة المسجّلة" });
    while ((await chip.count()) > 0) await chip.first().click();
  }
  await page.getByRole("button", { name: "سلّم الإجابات" }).click();
}

// Answers the comeback's recap on the plan page from the plan's quiz keys, the first `right` of its
// five items right and the others wrong, then hands it in.
async function takeRecap(page: Page, replay: Replay, right: number) {
  const items = page.locator("fieldset");
  await see(replay, items.nth(4));
  // The recap's items are the plan's quiz items, by quiz and item id.
  const { quizzes } = savedDoc<{ quizzes: Quiz[] }>(replay, "quizzes");
  const keys = new Map(
    quizzes.flatMap((q) => q.items.map((item) => [`q-${q.id}:${item.id}`, item])),
  );
  for (const i of [0, 1, 2, 3, 4]) {
    const item = items.nth(i);
    const key = keys.get((await item.getAttribute("id")) ?? "");
    if (!key) throw new Error(`No key for recap item ${i + 1}`);
    await item
      .getByRole("radio", { name: i < right ? key.answer : wrongOption(key), exact: true })
      .check();
  }
  await page.getByRole("button", { name: "سلّم الإجابات" }).click();
}

// The latest plan's title for a lesson.
function lessonTitle(replay: Replay, lessonId: string): string {
  type Plan = { committed: { lessons: { id: string; title_ar: string }[] } };
  const { versions } = savedDoc<{ versions: Plan[] }>(replay, "plan");
  const lesson = versions.at(-1)?.committed.lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new Error(`The plan has no lesson ${lessonId}`);
  return lesson.title_ar;
}

// Which of lessons 1 and 2 each level's run shows a diagram in: no image on the advanced run's pages
// or on the intermediate run's lesson-1 pages has a licence the diagrams agent takes (docs/demo.md).
const DIAGRAMS: Record<Level, { L1: boolean; L2: boolean }> = {
  beginner: { L1: true, L2: true },
  intermediate: { L1: false, L2: true },
  advanced: { L1: false, L2: false },
};

// Waits for the open lesson's diagrams step: its diagram when the run has one, otherwise the
// step's end with none.
async function diagramsDone(page: Page, replay: Replay, lessonId: string, level: Level) {
  const figure = page.locator(`img[src*="/diagrams/${lessonId}/"]`);
  if (DIAGRAMS[level][lessonId as "L1" | "L2"]) return see(replay, figure.first());
  await see(replay, page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }));
  await gone(replay, page.getByText(/يبحث مُعرِّب الرسوم/));
  await expect(figure).toHaveCount(0);
}

// The page scrolls inside <main>, so the window must not move: a window scrolled down hides the
// top bar, and a radio the window scrolls to leaves the screen blank.
async function windowStill(page: Page) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

// Step 13's «الأصل» and back to «بالعربية» on the relabelled diagram.
async function toggleVersions(page: Page) {
  const versions = page.getByRole("group", { name: "نسخة الرسم" });
  for (const [label, alt] of [
    ["الأصل", /كما في مصدره$/],
    ["بالعربية", /بتسميات عربية$/],
  ] as const) {
    await versions.getByText(label, { exact: true }).click();
    await expect(page.getByRole("img", { name: alt })).toBeVisible();
    await windowStill(page);
  }
}

// Steps 1 to 3: the interview through its chips, then the quick check answered by `pick`.
async function interview(page: Page, replay: Replay, pick: (q: Question, i: number) => string) {
  await page.goto(`${replay.url}/intake`);
  for (const n of ["١", "٢", "٣"]) {
    const chip = page.getByRole("button", { name: `املأ الرسالة المسجّلة (${n} من ٣)` });
    await see(replay, chip);
    await chip.click();
    await page.getByRole("button", { name: "أرسل", exact: true }).click();
  }
  await quickCheck(page, replay, pick);
}

async function quickCheck(page: Page, replay: Replay, pick: (q: Question, i: number) => string) {
  const items = page.locator("fieldset");
  await see(replay, items.nth(2));
  // The app keeps each question's answer in the session's interview, never in the page.
  const { questions } = savedDoc<{ questions: Question[] }>(replay, "intake");
  for (const [i, question] of questions.entries()) {
    await items
      .nth(i)
      .getByRole("radio", { name: pick(question, i), exact: true })
      .check();
  }
  await page.getByRole("button", { name: "أرسل إجاباتك" }).click();
}

// Step 4: the plan built and lesson 1 written, then lesson 1 opened.
async function lessonOne(page: Page, replay: Replay) {
  await page.getByRole("link", { name: /اذهب إلى خطتك/ }).click();
  const start = page.getByRole("link", { name: /ابدأ الدرس الأول/ });
  await see(replay, start);
  await start.click();
}

// The multiple-choice items each level's run missed on lesson 1's first quiz, by their place among
// them, to land below the gate: Omar's half-credit short answer leaves the beginner one to miss.
const FIRST_MISSED: Record<Level, number[]> = {
  beginner: [1],
  intermediate: [0, 1],
  advanced: [0, 1],
};

// Steps 6 and 7 as recorded, from the lesson's quiz page: below the gate, then a pass on a new
// quiz, each scored as the learner's own.
async function passLessonOne(page: Page, replay: Replay, level: Level) {
  await takeQuiz(page, replay, "L1", { wrong: FIRST_MISSED[level] });
  await see(replay, page.getByRole("heading", { name: /^لم تجتز الاختبار بعد/ }));
  await expect(page.getByRole("img", { name: /^نتيجتك / })).toBeVisible();
  await windowStill(page);
  await page.getByRole("button", { name: "ابدأ اختبارًا جديدًا" }).click();
  await takeQuiz(page, replay, "L1");
  await see(replay, page.getByRole("heading", { name: /^اجتزت الاختبار(?! في العرض)/ }));
  await expect(page.getByRole("img", { name: /^نتيجتك / })).toBeVisible();
  await windowStill(page);
}

// Step 8, in the tone given, or the form's own.
async function consent(page: Page, replay: Replay, tone?: string) {
  await page.goto(`${replay.url}/consent`);
  await page.getByRole("switch").first().check();
  // The radio sits under its label, which takes the click.
  const radio = page.getByRole("radio", { name: tone, exact: true });
  if (tone) await page.locator("label").filter({ has: radio }).click();
  await posted(page, /\/consent$/, () => page.locator('form button[type="submit"]').click());
}

// The demo bar's markers for `days`, clicked in turn on the coach page.
async function toDays(page: Page, replay: Replay, days: string[]) {
  await page.goto(`${replay.url}/coach`);
  for (const day of days) {
    const marker = page.getByRole("button", {
      name: new RegExp(`انتقل إلى اليوم ${day}(?![٠-٩])`),
    });
    await see(replay, marker);
    await posted(page, /\/sim\/\w+$/, () => marker.click());
  }
}

// A tap on the day-10 check-in's button `choice`.
async function tap(page: Page, replay: Replay, choice: string) {
  const button = page.getByRole("button", { name: choice });
  await see(replay, button);
  await posted(page, /\/inbox$/, () => button.click());
}

// The quick check answered to land on each level: «لا أعرف بعد» three times as Omar's run answered,
// two right, or all three right.
const PLACEMENTS: {
  name: string;
  pick: (q: Question, i: number) => string;
  level: Level;
  levelAr: string;
  // Whether replay plays this level from another level's recordings, and says so.
  borrowed: boolean;
}[] = [
  {
    name: "«لا أعرف بعد» three times",
    pick: () => DONT_KNOW,
    level: "beginner",
    levelAr: "مبتدئ",
    borrowed: false,
  },
  {
    name: "two right and «لا أعرف بعد»",
    pick: (q, i) => (i < 2 ? q.answer : DONT_KNOW),
    level: "intermediate",
    levelAr: "متوسط",
    borrowed: false,
  },
  {
    name: "all three right",
    pick: (q) => q.answer,
    level: "advanced",
    levelAr: "متقدم",
    borrowed: false,
  },
];

for (const placement of PLACEMENTS) {
  test(`replays the presenter's path with the placement check answered ${placement.name}`, async ({
    page,
    replay,
  }) => {
    const { level, borrowed } = placement;
    const at = (path: string) => `${replay.url}${path}`;
    // Only the replay pages say this; the note's wording is the intake's and the plan page's.
    const borrowedNote = page.getByText(/تُبنى خطتك في هذا العرض المسجّل على مسار المبتدئ/);
    const expectNote = async () => {
      if (borrowed) await expect.soft(borrowedNote).toBeVisible();
      else await expect.soft(borrowedNote).toHaveCount(0);
    };

    await test.step("1-3. The interview through its chips, then the quick check", async () => {
      await interview(page, replay, placement.pick);
      await see(replay, page.getByText(`مستواك الآن: ${placement.levelAr}`));
      await expectNote();
    });

    await test.step("4. The plan, built, and lesson 1 written", async () => {
      await page.getByRole("link", { name: /اذهب إلى خطتك/ }).click();
      const start = page.getByRole("link", { name: /ابدأ الدرس الأول/ });
      await see(replay, start);
      await expectNote();
      await start.click();
    });

    await test.step("5. Lesson 1 and its diagram, or none", async () => {
      await diagramsDone(page, replay, "L1", level);
      await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
    });

    await test.step("6-7. The quiz gate: below 80%, then a pass on a new quiz", async () => {
      await passLessonOne(page, replay, level);
    });

    await test.step("8. Consent to the coach's messages", async () => {
      await consent(page, replay);
    });

    await test.step("9-10. Coach days 2, 5 and 10, then «جلسات أقصر»", async () => {
      await toDays(page, replay, ["٢", "٥", "١٠"]);
      await tap(page, replay, "جلسات أقصر");
    });

    await test.step("11-12. The comeback review, three of five right, then version 2 accepted", async () => {
      await page.goto(at("/plan"));
      await takeRecap(page, replay, 3);
      const accept = page.getByRole("button", { name: "اعتمد الخطة الجديدة" });
      await see(replay, accept);
      await windowStill(page);
      await posted(page, /\/plan\/accept$/, () => accept.click());
    });

    await test.step("13. Progress, then lesson 2 and its diagram, or none", async () => {
      await page.goto(at("/progress"));
      const lesson2 = page.getByRole("link", { name: lessonTitle(replay, "L2") }).first();
      await see(replay, lesson2);
      await lesson2.click();
      await diagramsDone(page, replay, "L2", level);
      if (DIAGRAMS[level].L2) await toggleVersions(page);
    });

    const events = await noneMissing(page, replay);
    expect(events.filter((e) => e.summary_en.includes("plans on the beginner path"))).toHaveLength(
      borrowed ? 1 : 0,
    );
  });
}

// The learner's own words where the recorded run typed its own. Replay sends the recorded ones.
const OWN_MESSAGES = [
  "مرحبًا، أعمل محاسبًا منذ سنوات وأريد أن أصبح محلل بيانات.",
  "أستخدم الجداول كل يوم، ووقتي نحو خمس ساعات في الأسبوع.",
  "أقرأ بأي لغة، ولا أريد رسائل في الصباح.",
];

// The learner's own short answers to a quiz of lesson 1, one for each short item.
const ownShortAnswers = (replay: Replay) =>
  latestQuiz(replay, "L1")
    .items.filter((item) => item.type === "short")
    .map((_, i) => ["أرتب الأرقام في جدول وأجمعها.", "أصفي الجدول ثم أجمع ما بقي."][i % 2] ?? "");

// At the beginner's level and at another one, each on its own recordings.
for (const placement of PLACEMENTS.filter((p) => p.level !== "advanced")) {
  test(`keeps a learner who answers in their own way on the recorded run at ${placement.level}, with a note at each swap`, async ({
    page,
    replay,
  }) => {
    const { level } = placement;
    const notes = page.getByRole("note");

    await test.step("The interview in their own words: the recorded messages go, each with a note", async () => {
      await page.goto(`${replay.url}/intake`);
      const composer = page.getByRole("textbox", { name: "رسالتك إلى المحاور" });
      for (const [i, text] of OWN_MESSAGES.entries()) {
        // The next message's chip shows once the interviewer has answered the last one.
        const n = ["١", "٢", "٣"][i];
        await see(replay, page.getByRole("button", { name: `املأ الرسالة المسجّلة (${n} من ٣)` }));
        await composer.fill(text);
        await page.getByRole("button", { name: "أرسل", exact: true }).click();
      }
      await quickCheck(page, replay, placement.pick);
      await see(replay, page.getByText(`مستواك الآن: ${placement.levelAr}`));
      await expect(page.getByRole("log").getByRole("note")).toHaveCount(3);
    });

    await test.step("Lesson 1's quiz with their own short answers: the recorded ones are graded", async () => {
      await lessonOne(page, replay);
      await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
      await see(replay, page.getByRole("button", { name: "سلّم الإجابات" }));
      const shorts = ownShortAnswers(replay);
      await takeQuiz(page, replay, "L1", { wrong: FIRST_MISSED[level], shorts });
      await see(replay, page.getByRole("img", { name: /^النتيجة مع الإجابات المسجّلة / }));
      await expect(page.getByRole("heading", { name: /^لم تجتز الاختبار بعد/ })).toBeVisible();
      // One on the result, one on each short answer.
      await expect(notes).toHaveCount(1 + shorts.length);
    });

    await test.step("The retry with two wrong picks: their keys are graded, and lesson 2 opens", async () => {
      await page.getByRole("button", { name: "ابدأ اختبارًا جديدًا" }).click();
      await see(replay, page.getByRole("button", { name: "سلّم الإجابات" }));
      const shorts = ownShortAnswers(replay);
      await takeQuiz(page, replay, "L1", { wrong: [0, 1], shorts });
      await see(replay, page.getByRole("heading", { name: /اجتزت الاختبار في العرض المسجّل/ }));
      await expect(page.getByRole("img", { name: /^النتيجة مع الإجابات المسجّلة / })).toBeVisible();
      // One on the result, one on each wrong pick and one on each short answer.
      await expect(notes).toHaveCount(3 + shorts.length);
    });

    await test.step("The lesson and the plan say it was passed in the recorded demo", async () => {
      await page.goto(`${replay.url}/lesson/L1`);
      await see(replay, page.getByText("اجتزت اختبار هذا الدرس في العرض المسجّل."));
      await page.goto(`${replay.url}/plan`);
      await see(replay, page.getByText("اجتزته في العرض المسجّل"));
    });

    await test.step("The tone «عادي», then the plan page on day 2 holds the comeback", async () => {
      await consent(page, replay, "عادي");
      await toDays(page, replay, ["٢"]);
      await page.goto(`${replay.url}/plan`);
      await see(replay, notes.first());
      await expect(notes).toHaveAttribute("data-held", "checkin");
    });

    await test.step("«مصدر آخر» on day 10, and a recap all right: the recorded recap is graded", async () => {
      await toDays(page, replay, ["٥", "١٠"]);
      await tap(page, replay, "مصدر آخر");
      await page.goto(`${replay.url}/plan`);
      await takeRecap(page, replay, 5);
      const accept = page.getByRole("button", { name: "اعتمد الخطة الجديدة" });
      await see(replay, accept);
      await expect(notes).toHaveCount(1);
      await expect(page.getByText(/^المراجعة المسجّلة ٣ من ٥/)).toBeVisible();
      await posted(page, /\/plan\/accept$/, () => accept.click());
    });

    await test.step("Lesson 2, written again from Spark's pick, and its quiz to read only", async () => {
      await page.goto(`${replay.url}/lesson/L2`);
      await see(replay, page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }));
      await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
      await expect(page).toHaveURL(/\/quiz\/L2$/);
      await see(replay, notes.first());
      await expect(page.locator("fieldset:disabled")).not.toHaveCount(0);
      await expect(page.getByRole("button", { name: "سلّم الإجابات" })).toHaveCount(0);
    });

    const events = await noneMissing(page, replay);
    expect(events.filter((e) => e.summary_en.includes("recorded gentle tone"))).not.toEqual([]);
  });
}

// Confirms the demo bar's «إعادة»: the question, then «نعم، ابدأ من الصفر», which reloads.
async function confirmReset(page: Page) {
  await page.getByRole("button", { name: "إعادة", exact: true }).click();
  const confirm = page.getByRole("button", { name: "نعم، ابدأ من الصفر" });
  await expect(confirm).toBeVisible();
  const loaded = page.waitForEvent("load");
  await posted(page, /\/sim\/reset$/, () => confirm.click());
  await loaded;
}

test("after the chase, reset starts a new placement on day 0 with an empty feed", async ({
  page,
  replay,
}) => {
  await interview(page, replay, () => DONT_KNOW);
  await lessonOne(page, replay);
  await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
  await passLessonOne(page, replay, "beginner");
  await consent(page, replay);
  await toDays(page, replay, ["٢", "٥", "١٠"]);
  await tap(page, replay, "جلسات أقصر");

  await page.goto(`${replay.url}/plan`);
  await see(replay, page.getByRole("timer", { name: /اليوم ١٠/ }).first());
  await expect(page.getByLabel("خطوات الوكلاء، الأقدم أولًا")).toBeVisible();

  await confirmReset(page);
  await see(replay, page.getByRole("timer", { name: /يوم البدء/ }).first());
  await expect(page.getByLabel("خطوات الوكلاء، الأقدم أولًا")).toHaveCount(0);
  await expect(page.getByText("حين يبدأ الوكلاء العمل على دورتك")).toBeVisible();

  const intermediate = PLACEMENTS.find((p) => p.level === "intermediate");
  if (!intermediate) throw new Error("no intermediate placement");
  await interview(page, replay, intermediate.pick);
  await see(replay, page.getByText(`مستواك الآن: ${intermediate.levelAr}`));
  await expect(page.getByRole("timer", { name: /يوم البدء/ }).first()).toBeVisible();
  await expect(page.getByRole("timer", { name: /اليوم ١٠/ })).toHaveCount(0);
});

test("holds the comeback after «استراحة أسبوع», and sends the weekly message on day 17 as its template", async ({
  page,
  replay,
}) => {
  await interview(page, replay, () => DONT_KNOW);
  await lessonOne(page, replay);
  await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
  await passLessonOne(page, replay, "beginner");
  await consent(page, replay);
  await toDays(page, replay, ["٢", "٥", "١٠"]);
  await tap(page, replay, "استراحة أسبوع");

  await page.goto(`${replay.url}/plan`);
  const held = page.getByRole("note");
  await see(replay, held);
  await expect(held).toHaveAttribute("data-held", "paused");
  await toDays(page, replay, ["١٧"]);

  const events = await noneMissing(page, replay);
  expect(
    events.filter((e) => e.summary_en.endsWith("replay has no recording of its wording")),
  ).toEqual([expect.objectContaining({ summary_en: expect.stringMatching(/^weekly_a0_d17: /) })]);
});
