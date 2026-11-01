// The presenter's path in docs/demo.md, steps 1 to 13, clicked through in a real browser against the
// built app in replay (#55). Each test starts its own server on emptied data, so every request the
// app's route handlers make must have a recording. A request with none fails the walk at once with
// the server's log line for it. It runs once per placement level: «لا أعرف بعد» three times as the
// recorded run answered (beginner), two right (intermediate) and all three right (advanced). Replay
// plays the last two from the beginner's recordings. Selectors use roles and the recorded run's own
// words, never banner wording; the borrowed-level note and swap event are matched by text on purpose.

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

type Question = { id: string; options_ar: string[]; answer: string };

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
      await page.goto(at("/intake"));
      for (const n of ["١", "٢", "٣"]) {
        const chip = page.getByRole("button", { name: `املأ الرسالة المسجّلة (${n} من ٣)` });
        await see(replay, chip);
        await chip.click();
        await page.getByRole("button", { name: "أرسل", exact: true }).click();
      }
      const items = page.locator("fieldset");
      await see(replay, items.nth(2));
      // The app keeps each question's answer in the session's interview, never in the page.
      const { questions } = JSON.parse(
        readFileSync(join(replay.data, "sessions", DEMO_SESSION_ID, "intake.json"), "utf8"),
      ) as { questions: Question[] };
      for (const [i, question] of questions.entries()) {
        await items
          .nth(i)
          .getByRole("radio", { name: placement.pick(question, i), exact: true })
          .check();
      }
      await page.getByRole("button", { name: "أرسل إجاباتك" }).click();
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
      await see(replay, page.locator("fieldset").nth(3));
      await takeQuiz(page, [
        "المصنف (classeur) ملف يجمع ورقة عمل",
        "بحذف القيم القديمة وإعادة كتابة المجاميع يدويا",
        "توليد خلاصة تلخص الجدول الكبير",
        "تعرض الصفوف التي تحقق شرط بند الإيجار فقط",
      ]);
      await see(replay, page.getByRole("img", { name: /نتيجتك ٧٥٪/ }));
      await page.getByRole("button", { name: "ابدأ اختبارًا جديدًا" }).click();
      await see(replay, page.locator("fieldset").nth(3));
      await takeQuiz(page, [
        "برنامج جداول البيانات (tableur) هو البرنامج الذي يعرض الشبكة",
        "معادلة ضرب تشير إلى خليتي الكمية والسعر",
        "المصنف ملف واحد للسنة يضم أوراقا مستقلة",
        "التصفية تعرض سطور الرواتب فقط",
      ]);
      await see(replay, page.getByRole("img", { name: /نتيجتك ١٠٠٪/ }));
    });

    await test.step("8. Consent to the coach's messages", async () => {
      await page.goto(at("/consent"));
      await page.getByRole("switch").first().check();
      await posted(page, /\/consent$/, () => page.locator('form button[type="submit"]').click());
    });

    await test.step("9-10. Coach days 2, 5 and 10, then «جلسات أقصر»", async () => {
      await page.goto(at("/coach"));
      for (const day of ["٢", "٥", "١٠"]) {
        const marker = page.getByRole("button", {
          name: new RegExp(`انتقل إلى اليوم ${day}(?![٠-٩])`),
        });
        await see(replay, marker);
        await posted(page, /\/sim\/\w+$/, () => marker.click());
      }
      const shorter = page.getByRole("button", { name: "جلسات أقصر" });
      await see(replay, shorter);
      await posted(page, /\/inbox$/, () => shorter.click());
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

    // What the trace drawer reads: no model call without a recording, and no page either.
    const trace = await page.request.get(at(`/api/sessions/${DEMO_SESSION_ID}/trace`));
    const { events } = (await trace.json()) as {
      events: { missing_recording?: string; summary_en: string }[];
    };
    expect(events.filter((e) => e.missing_recording)).toEqual([]);
    expect(events.filter((e) => e.summary_en.includes("plans on the beginner path"))).toHaveLength(
      placement.borrowed ? 1 : 0,
    );
    expect(events.filter((e) => e.summary_en.includes("No recorded page"))).toEqual([]);
    expect(missingRecordings(replay)).toEqual([]);
  });
}
