// The missing-recording banner (#56). Its events come from the real orchestrator, provider and sim,
// so a change to what they trace breaks this test instead of the banner.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import Type from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createSim } from "../../server/clock/sim";
import { type Agent, createOrchestrator } from "../../server/orchestrator/orchestrator";
import { parseModels } from "../../server/providers/models";
import { createProvider } from "../../server/providers/provider";
import { createFileStore } from "../../server/store/store";
import { createPageFetcher } from "../../server/tools/fetch-page";
import type { TraceEvent } from "../../server/trace/trace";
import {
  bannerMiss,
  blockingMiss,
  dismissedMisses,
  MissingRecordingNotice,
  restartDemo,
  stoppedOnMiss,
} from "./missing-recording";
import { TraceProvider } from "./trace-provider";

const MODELS = parseModels(`
roles:
  agent_default: {provider: meta, model: muse-spark-1.3}
prices:
  muse-spark-1.3: {input: 1.25, cached_input: 0.15, output: 4.25}
`);
const Done = Type.Object({ done: Type.Boolean() }, { additionalProperties: false });

// A session whose provider and page fetcher replay from an empty folder: every model call and every
// page has no recording.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "missing-"));
  const store = createFileStore(dir);
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({ models: MODELS, profile: "replay", fixturesDir: dir, onTrace }),
  });
  const pages = createPageFetcher({ profile: "replay", userAgent: "test", fixturesDir: dir });
  const step = (agent: string, ask?: "model" | "page"): Agent<null, typeof Done> => ({
    name: agent,
    output: Done,
    async run(ctx) {
      if (ask === "model") {
        await ctx.provider.chat({
          role: "agent_default",
          input: "hello",
          trace: { agent, summary_ar: "يكتب", summary_en: "Writing" },
        });
      }
      if (ask === "page") await pages.fetchPage("https://fr.wikipedia.org/wiki/Tableur", ctx.trace);
      return { done: true };
    },
  });
  return {
    // A step whose model call has no recording, retried once and failed.
    misses: (agent: string) =>
      orchestrator.runStep("s_1", step(agent, "model"), null).catch(() => undefined),
    // A step whose page has no recording.
    missesPage: (agent: string) =>
      orchestrator.runStep("s_1", step(agent, "page"), null).catch(() => undefined),
    // A step of the agent that finishes with no model call.
    finishes: (agent: string) => orchestrator.runStep("s_1", step(agent), null),
    reset: () => createSim({ store, sessionId: "s_1", seed: loadOmarSeed("x") }).reset(),
    trace: () => store.readTrace<TraceEvent>("s_1"),
  };
}

describe("blockingMiss", () => {
  it("is the newest request with no recording, the retry's", async () => {
    const { misses, trace } = setup();
    await misses("scout");

    const missed = trace().filter((e) => e.missing_recording);
    expect(missed).toHaveLength(2);
    expect(blockingMiss(trace())).toEqual(missed[1]);
  });

  it("is gone after the demo's reset", async () => {
    const { misses, reset, trace } = setup();
    await misses("scout");

    reset();

    expect(blockingMiss(trace())).toBeUndefined();
  });

  it("is gone once its agent finishes a step, and stays while another agent works", async () => {
    const { misses, finishes, trace } = setup();
    await misses("intake");

    await finishes("diagrams");
    expect(blockingMiss(trace())?.agent).toBe("intake");
    await finishes("intake");
    expect(blockingMiss(trace())).toBeUndefined();
  });
});

const notice = (miss: TraceEvent) =>
  renderToStaticMarkup(
    <TraceProvider sessionId="s_1">
      <MissingRecordingNotice miss={miss} onDismiss={() => {}} />
    </TraceProvider>,
  );

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("the banner", () => {
  it("says in plain Arabic which step stopped and offers the restart, with no hash or path", async () => {
    const { misses, trace } = setup();
    await misses("scout");
    const miss = blockingMiss(trace());
    if (!miss?.missing_recording) throw new Error("no miss");

    const html = notice(miss);

    expect(text(html)).toContain(
      "توقّف العرض عند البحث عن المصادر. هذا الجزء من العرض غير مسجّل، فلن تنجح إعادة المحاولة.",
    );
    expect(html).toContain("ابدأ العرض من جديد");
    expect(html).toContain('aria-label="أخفِ هذا التنبيه"');
    expect(html).not.toContain(miss.missing_recording);
    expect(html).not.toMatch(/docs\/demo|\.json|الكشّاف/);
  });

  it("names a missing page as a page, and blames no answer for either (#86)", async () => {
    const { misses, missesPage, trace } = setup();
    await missesPage("lesson_builder");
    const page = blockingMiss(trace());
    await misses("examiner");
    const reply = blockingMiss(trace());
    if (page?.agent !== "lesson_builder" || reply?.agent !== "examiner") throw new Error("no miss");

    const [pageText, replyText] = [text(notice(page)), text(notice(reply))];

    expect(pageText).toContain(
      "توقّف العرض عند كتابة الدرس. إحدى صفحات المصادر غير مسجّلة في العرض، فلن تنجح إعادة المحاولة.",
    );
    expect(replyText).toContain("توقّف العرض عند الاختبار. هذا الجزء من العرض غير مسجّل");
    for (const said of [pageText, replyText]) expect(said).not.toMatch(/إجابة أو رسالة تختلف/);
  });

  it("points to the recorded message's chip when the interviewer's reply is missing", async () => {
    const { misses, trace } = setup();
    await misses("intake");
    const miss = blockingMiss(trace());
    if (!miss) throw new Error("no miss");

    expect(notice(miss)).toContain("اضغط «املأ الرسالة المسجّلة» وأرسلها كما هي");
  });
});

describe("stoppedOnMiss", () => {
  it("holds for each step whose request has no recording until that step finishes", async () => {
    const { misses, finishes, trace } = setup();
    await misses("lesson_builder");
    await misses("examiner");

    expect(stoppedOnMiss(trace(), "lesson_builder")).toBe(true);
    expect(stoppedOnMiss(trace(), "examiner")).toBe(true);
    expect(stoppedOnMiss(trace(), "diagrams")).toBe(false);
    await finishes("lesson_builder");
    expect(stoppedOnMiss(trace(), "lesson_builder")).toBe(false);
  });
});

describe("where the banner shows", () => {
  it("is not on the plan page for the scout's or the architect's miss, which the page explains", async () => {
    const { misses, trace } = setup();
    await misses("scout");
    const miss = blockingMiss(trace());

    expect(bannerMiss(trace(), "/plan", [])).toBeUndefined();
    expect(bannerMiss(trace(), "/progress", [])).toEqual(miss);
  });

  it("is on the plan page for another step's miss", async () => {
    const { misses, trace } = setup();
    await misses("lesson_builder");

    expect(bannerMiss(trace(), "/plan", [])?.agent).toBe("lesson_builder");
  });
});

describe("restartDemo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answering = (statuses: Record<string, number>) => {
    const posted: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      posted.push(`${init.method} ${url}`);
      return new Response("{}", { status: statuses[url] ?? 200 });
    });
    const saved = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    return posted;
  };

  it("resets the session as the demo bar does", async () => {
    const posted = answering({});

    expect(await restartDemo("demo", [])).toBe(true);
    expect(posted).toEqual(["POST /api/sessions/demo/sim/reset"]);
  });

  it("forgets the interview when the simulated clock, and so its reset, is off", async () => {
    const posted = answering({ "/api/sessions/demo/sim/reset": 404 });

    expect(await restartDemo("demo", [])).toBe(true);
    expect(posted).toEqual([
      "POST /api/sessions/demo/sim/reset",
      "POST /api/sessions/demo/intake/reset",
    ]);
  });

  it("takes the banner down with the simulated clock off, whose reset traces nothing (#82)", async () => {
    const { misses, trace } = setup();
    await misses("scout");
    answering({ "/api/sessions/demo/sim/reset": 404 });
    expect(bannerMiss(trace(), "/intake", dismissedMisses())).toBeDefined();

    await restartDemo("demo", trace());

    expect(bannerMiss(trace(), "/intake", dismissedMisses())).toBeUndefined();
  });
});
