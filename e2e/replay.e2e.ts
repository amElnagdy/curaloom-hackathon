// The presenter's path in docs/demo.md, steps 1 to 13, clicked through in a real browser against the
// built app in replay (#55). Each test starts its own server on emptied data, so every request the
// app's route handlers make must have a recording. A request with none fails the walk at once with
// the server's log line for it. It runs once per placement level: «لا أعرف بعد» three times as the
// recorded run answered (beginner), two right (intermediate) and all three right (advanced). Replay
// plays the last two from the beginner's recordings. Two more tests leave the recorded path where
// replay keeps the learner on it with a note: their own words, wrong picks and another tone, and
// «استراحة أسبوع» at the check-in. Selectors use roles and the recorded run's own words, never
// banner wording; the borrowed-level note and swap event are matched by text on purpose, the replay
// notes by their role.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { demoServer } from "../demo/run.ts";
import { DEMO_SESSION_ID } from "../demo/session.ts";
import { DONT_KNOW } from "../src/server/agents/intake/diagnostic.ts";

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

// Picks each multiple-choice item's option that starts with the given words, fills the short
// answers with their recorded chips, and hands the quiz in.
async function takeQuiz(page: Page, picks: string[]) {
  const items = page.locator("fieldset");
  for (const [i, words] of picks.entries()) {
    await items.nth(i).locator("label", { hasText: words }).click();
  }
  const chip = page.getByRole("button", { name: "املأ الإجابة المسجّلة" });
  while ((await chip.count()) > 0) await chip.first().click();
  await page.getByRole("button", { name: "سلّم الإجابات" }).click();
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

const FIRST_PICKS = [
  "المصنف (classeur) ملف يجمع ورقة عمل",
  "بحذف القيم القديمة وإعادة كتابة المجاميع يدويا",
  "توليد خلاصة تلخص الجدول الكبير",
  "تعرض الصفوف التي تحقق شرط بند الإيجار فقط",
];
const RETRY_PICKS = [
  "برنامج جداول البيانات (tableur) هو البرنامج الذي يعرض الشبكة",
  "معادلة ضرب تشير إلى خليتي الكمية والسعر",
  "المصنف ملف واحد للسنة يضم أوراقا مستقلة",
  "التصفية تعرض سطور الرواتب فقط",
];

// Steps 6 and 7 as recorded, from the lesson's quiz page: 75%, then 100% on a new quiz.
async function passLessonOne(page: Page, replay: Replay) {
  await see(replay, page.locator("fieldset").nth(3));
  await takeQuiz(page, FIRST_PICKS);
  await see(replay, page.getByRole("img", { name: /نتيجتك ٧٥٪/ }));
  await page.getByRole("button", { name: "ابدأ اختبارًا جديدًا" }).click();
  await see(replay, page.locator("fieldset").nth(3));
  await takeQuiz(page, RETRY_PICKS);
  await see(replay, page.getByRole("img", { name: /نتيجتك ١٠٠٪/ }));
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

const PLACEMENTS: {
  name: string;
  pick: (q: Question, i: number) => string;
  level: string;
  // Whether replay plays this level from another level's recordings, and says so.
  borrowed: boolean;
}[] = [
  { name: "«لا أعرف بعد» three times", pick: () => DONT_KNOW, level: "مبتدئ", borrowed: false },
  {
    name: "two right and «لا أعرف بعد»",
    pick: (q, i) => (i < 2 ? q.answer : DONT_KNOW),
    level: "متوسط",
    borrowed: true,
  },
  { name: "all three right", pick: (q) => q.answer, level: "متقدم", borrowed: true },
];

for (const placement of PLACEMENTS) {
  test(`replays the presenter's path with the placement check answered ${placement.name}`, async ({
    page,
    replay,
  }) => {
    const at = (path: string) => `${replay.url}${path}`;
    // Only the replay pages say this; the note's wording is the intake's and the plan page's.
    const borrowedNote = page.getByText(/تُبنى خطتك في هذا العرض المسجّل على مسار المبتدئ/);

    await test.step("1-3. The interview through its chips, then the quick check", async () => {
      await interview(page, replay, placement.pick);
      await see(replay, page.getByText(`مستواك الآن: ${placement.level}`));
      if (placement.borrowed) await expect.soft(borrowedNote).toBeVisible();
      else await expect.soft(borrowedNote).toHaveCount(0);
    });

    await test.step("4. The plan, built, and lesson 1 written", async () => {
      await page.getByRole("link", { name: /اذهب إلى خطتك/ }).click();
      const start = page.getByRole("link", { name: /ابدأ الدرس الأول/ });
      await see(replay, start);
      if (placement.borrowed) await expect.soft(borrowedNote).toBeVisible();
      else await expect.soft(borrowedNote).toHaveCount(0);
      await start.click();
    });

    await test.step("5. Lesson 1 and its diagram", async () => {
      await see(replay, page.locator('img[src*="/diagrams/L1/"]').first());
      await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
    });

    await test.step("6-7. The quiz gate: 75%, then 100% on a new quiz", async () => {
      await passLessonOne(page, replay);
    });

    await test.step("8. Consent to the coach's messages", async () => {
      await consent(page, replay);
    });

    await test.step("9-10. Coach days 2, 5 and 10, then «جلسات أقصر»", async () => {
      await toDays(page, replay, ["٢", "٥", "١٠"]);
      await tap(page, replay, "جلسات أقصر");
    });

    await test.step("11-12. The comeback review, then version 2 accepted", async () => {
      await page.goto(at("/plan"));
      await see(replay, page.locator("fieldset").nth(4));
      await takeQuiz(page, [
        "بتخزين معادلة تجمع أو تطرح قيم خلايا أخرى",
        "المصنف (classeur) ملف يجمع ورقة عمل",
        "توليد خلاصة تلخص الجدول الكبير",
        "ترتب الصفوف من الأكبر إلى الأصغر",
        "برنامج جداول البيانات (tableur) هو خلية واحدة",
      ]);
      const accept = page.getByRole("button", { name: "اعتمد الخطة الجديدة" });
      await see(replay, accept);
      await posted(page, /\/plan\/accept$/, () => accept.click());
    });

    await test.step("13. Progress, then lesson 2 and its diagram", async () => {
      await page.goto(at("/progress"));
      const lesson2 = page.getByRole("link", { name: /ما الجدول المحوري/ }).first();
      await see(replay, lesson2);
      await lesson2.click();
      await see(replay, page.locator('img[src*="/diagrams/L2/"]').first());
    });

    const events = await noneMissing(page, replay);
    expect(events.filter((e) => e.summary_en.includes("plans on the beginner path"))).toHaveLength(
      placement.borrowed ? 1 : 0,
    );
  });
}

// The learner's own words where the recorded run typed its own. Replay sends the recorded ones.
const OWN_MESSAGES = [
  "مرحبًا، أعمل محاسبًا منذ سنوات وأريد أن أصبح محلل بيانات.",
  "أستخدم الجداول كل يوم، ووقتي نحو خمس ساعات في الأسبوع.",
  "أقرأ بأي لغة، ولا أريد رسائل في الصباح.",
];
const OWN_SHORT_ANSWERS = ["أرتب الأرقام في جدول وأجمعها.", "أصفي الجدول ثم أجمع ما بقي."];

// Writes the learner's own short answers into the quiz's text boxes.
async function writeShortAnswers(page: Page) {
  const boxes = page.getByRole("textbox");
  for (const [i, text] of OWN_SHORT_ANSWERS.entries()) await boxes.nth(i).fill(text);
}

test("keeps a learner who answers in their own way on the recorded run, with a note at each swap", async ({
  page,
  replay,
}) => {
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
    await quickCheck(page, replay, () => DONT_KNOW);
    await see(replay, page.getByText("مستواك الآن: مبتدئ"));
    await expect(page.getByRole("log").getByRole("note")).toHaveCount(3);
  });

  await test.step("Lesson 1's quiz with their own short answers: the recorded ones are graded", async () => {
    await lessonOne(page, replay);
    await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
    await see(replay, page.locator("fieldset").nth(3));
    for (const [i, words] of FIRST_PICKS.entries()) {
      await page.locator("fieldset").nth(i).locator("label", { hasText: words }).click();
    }
    await writeShortAnswers(page);
    await page.getByRole("button", { name: "سلّم الإجابات" }).click();
    await see(replay, page.getByRole("img", { name: /النتيجة مع الإجابات المسجّلة ٧٥٪/ }));
    // One on the result, one on each short answer.
    await expect(notes).toHaveCount(3);
  });

  await test.step("The retry with two wrong picks: their keys are graded, and lesson 2 opens", async () => {
    await page.getByRole("button", { name: "ابدأ اختبارًا جديدًا" }).click();
    const items = page.locator("fieldset");
    await see(replay, items.nth(3));
    for (const [i, words] of RETRY_PICKS.entries()) {
      const options = items.nth(i).locator("label");
      await (i < 2
        ? options.filter({ hasNotText: words }).first()
        : options.filter({ hasText: words })
      ).click();
    }
    await writeShortAnswers(page);
    await page.getByRole("button", { name: "سلّم الإجابات" }).click();
    await see(replay, page.getByRole("heading", { name: /اجتزت الاختبار في العرض المسجّل/ }));
    await expect(page.getByRole("img", { name: /النتيجة مع الإجابات المسجّلة ١٠٠٪/ })).toBeVisible();
    // One on the result, one on each wrong pick and one on each short answer.
    await expect(notes).toHaveCount(5);
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
    const items = page.locator("fieldset");
    await see(replay, items.nth(4));
    // The recap's items are the plan's quiz items, by quiz and item id.
    const { quizzes } = savedDoc<{ quizzes: { id: string; items: Question[] }[] }>(
      replay,
      "quizzes",
    );
    const keys = new Map(
      quizzes.flatMap((q) => q.items.map((item) => [`q-${q.id}:${item.id}`, item.answer])),
    );
    for (const i of [0, 1, 2, 3, 4]) {
      const item = items.nth(i);
      const answer = keys.get((await item.getAttribute("id")) ?? "");
      await item.getByRole("radio", { name: answer, exact: true }).check();
    }
    await page.getByRole("button", { name: "سلّم الإجابات" }).click();
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

test("holds the comeback after «استراحة أسبوع», and sends the weekly message on day 17 as its template", async ({
  page,
  replay,
}) => {
  await interview(page, replay, () => DONT_KNOW);
  await lessonOne(page, replay);
  await page.getByRole("link", { name: /^(ابدأ|إلى) الاختبار/ }).click();
  await passLessonOne(page, replay);
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
