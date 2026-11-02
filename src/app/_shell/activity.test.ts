// Seam S1: trace events become plain-Arabic feed lines. The events come from the real orchestrator
// and tracer, so a change to their wording breaks this test instead of the feed.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Type from "typebox";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createSim } from "../../server/clock/sim";
import { type Agent, createOrchestrator } from "../../server/orchestrator/orchestrator";
import { parseModels } from "../../server/providers/models";
import { createProvider } from "../../server/providers/provider";
import { createFileStore } from "../../server/store/store";
import { createTracer, type TraceEvent } from "../../server/trace/trace";
import { clockNow, stepsRunning, toActivityItem } from "./activity";

const MODELS = parseModels(`
roles:
  agent_default: {provider: meta, model: muse-spark-1.3}
prices:
  muse-spark-1.3: {input: 1.25, cached_input: 0.15, output: 4.25}
`);
const Count = Type.Object({ found: Type.Integer() }, { additionalProperties: false });

function setup() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "activity-")));
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) => createProvider({ models: MODELS, profile: "replay", onTrace }),
  });
  const trace = () => store.readTrace<TraceEvent>("s_1");
  return { store, orchestrator, trace };
}

// A scout that traces one tool call, then returns each of `outputs` in turn.
function scout(outputs: unknown[]): Agent<null, typeof Count> {
  return {
    name: "scout",
    output: Count,
    async run(ctx) {
      ctx.trace({
        kind: "tool_call",
        summary_ar: "وجد 3 مصادر، منها Open Data 2024",
        summary_en: "web_search: 3 results",
      });
      return outputs.shift();
    },
  };
}

const lines = (events: TraceEvent[]) => events.map(toActivityItem);

describe("toActivityItem", () => {
  it("turns a step start into the agent's job, under its Arabic name", async () => {
    const { orchestrator, trace } = setup();
    await orchestrator.runStep("s_1", scout([{ found: 3 }]), null);

    expect(toActivityItem(trace()[0] as TraceEvent)).toMatchObject({
      id: "evt_0001",
      agentName: "الكشّاف",
      tone: "working",
      text: expect.stringMatching(/^بدأ العمل: .*مصادر مفتوحة/),
    });
  });

  it("keeps a tool call's Arabic summary, with Arabic-Indic digits outside foreign text", async () => {
    const { orchestrator, trace } = setup();
    await orchestrator.runStep("s_1", scout([{ found: 3 }]), null);

    expect(toActivityItem(trace()[1] as TraceEvent)).toMatchObject({
      tone: "working",
      text: "وجد ٣ مصادر، منها Open Data 2024",
    });
  });

  it("turns a valid output into a calm done line", async () => {
    const { orchestrator, trace } = setup();
    await orchestrator.runStep("s_1", scout([{ found: 3 }]), null);

    expect(toActivityItem(trace().at(-1) as TraceEvent)).toMatchObject({
      tone: "done",
      text: expect.stringContaining("أنهى عمله"),
    });
  });

  it("says plainly that a first invalid output is being retried", async () => {
    const { orchestrator, trace } = setup();
    await orchestrator.runStep("s_1", scout([{ found: "three" }, { found: 3 }]), null);

    const retry = trace().find((e) => e.kind === "error") as TraceEvent;
    const item = toActivityItem(retry);
    expect(item).toMatchObject({
      tone: "retrying",
      text: expect.stringContaining("يعيد المحاولة"),
    });
    expect(item?.text).not.toMatch(/scout|found|[A-Za-z]/);
  });

  it("says honestly that a step failed after its retry", async () => {
    const { orchestrator, trace } = setup();
    await expect(
      orchestrator.runStep("s_1", scout([{ found: "three" }, { found: "four" }]), null),
    ).rejects.toThrow();

    expect(toActivityItem(trace().at(-1) as TraceEvent)).toMatchObject({
      tone: "failed",
      text: expect.stringContaining("تعذّر"),
    });
  });

  it("adds nothing when a finished step is resumed from its saved output", async () => {
    const { orchestrator, trace } = setup();
    await orchestrator.runStep("s_1", scout([{ found: 3 }]), null);
    const before = trace().length;
    await orchestrator.runStep("s_1", scout([]), null);

    expect(lines(trace().slice(before))).toEqual([null]);
  });

  it("shows what a model call did, never the model id or its cost", () => {
    const { store } = setup();
    const event = createTracer(store, "s_1").fromProvider({
      agent: "architect",
      summary_ar: "اقترح خطة من 3 وحدات",
      summary_en: "Drafted a plan with 3 modules",
      kind: "model_call",
      role: "curriculum",
      model: "muse-wonder-1.0",
      profile: "replay",
      attempt: 1,
      ok: true,
      latency_ms: 1900,
      cost_usd: 0.0094,
      total_cost_usd: 0.0094,
    });

    const item = toActivityItem(event);
    expect(item).toMatchObject({ agentName: "المهندس", tone: "working" });
    expect(item?.text).toBe("اقترح خطة من ٣ وحدات");
  });

  it("turns a failed model call into a warning that promises no retry and hides the error", () => {
    const { store } = setup();
    const event = createTracer(store, "s_1").fromProvider({
      agent: "lesson_builder",
      summary_ar: "كتابة الدرس الأول",
      summary_en: "Writing lesson 1",
      kind: "model_call",
      role: "agent_default",
      model: "muse-spark-1.3",
      profile: "live",
      attempt: 1,
      ok: false,
      latency_ms: 30000,
      cost_usd: 0,
      total_cost_usd: 0,
      error: "HTTP 503 upstream unavailable",
    });

    // The provider gives up after its last attempt or on an error it cannot retry, so the line
    // must not say a retry follows.
    const item = toActivityItem(event);
    expect(item).toMatchObject({ agentName: "صانع الدروس", tone: "warning" });
    expect(item?.text).not.toMatch(/محاولة|تُعاد|يعيد/);
    expect(item?.text).not.toMatch(/[A-Za-z0-9٠-٩]/);
  });

  it("marks an error an agent reports itself as a warning, in its own words", () => {
    const { store } = setup();
    const event = createTracer(store, "s_1").emit({
      agent: "scout",
      kind: "error",
      summary_ar: "تعذّر فتح صفحة الترخيص لمصدر واحد",
      summary_en: "licence page fetch failed for one source",
    });

    expect(toActivityItem(event)).toMatchObject({
      tone: "warning",
      text: "تعذّر فتح صفحة الترخيص لمصدر واحد",
    });
  });

  it("names the dummy agent, and gives an unknown agent a generic name", () => {
    const { store } = setup();
    const tracer = createTracer(store, "s_1");
    const event = (agent: string) =>
      tracer.emit({ agent, kind: "decision", summary_ar: "قرار", summary_en: "decision" });

    expect(toActivityItem(event("dummy"))?.agentName).toBe("وكيل تجريبي");
    expect(toActivityItem(event("x_agent"))?.agentName).toBe("وكيل");
  });

  it("dates a line by its simulated time", async () => {
    const { store, orchestrator, trace } = setup();
    await createSim({ store, sessionId: "s_1", seed: loadOmarSeed("x") }).set(2);
    await orchestrator.runStep("s_1", scout([{ found: 3 }]), null);

    expect(toActivityItem(trace().at(-1) as TraceEvent)?.simAt).toEqual({ day: 2, minute: 720 });
  });

  it("leaves the clock, the coach scheduler, the notifier and a demo reset out of the feed", async () => {
    const { store, trace } = setup();
    const sim = createSim({ store, sessionId: "s_1", seed: loadOmarSeed("x") });
    await sim.set(10);
    sim.reset();

    expect(trace().map((e) => e.agent)).toEqual(expect.arrayContaining(["scheduler", "sim"]));
    expect(lines(trace()).every((line) => line === null)).toBe(true);
  });
});

describe("clockNow", () => {
  it("reads the simulated clock from the trace, back to day 0 on reset", async () => {
    const { store, trace } = setup();
    const sim = () => createSim({ store, sessionId: "s_1", seed: loadOmarSeed("x") });

    expect(clockNow(trace())).toEqual({ day: 0, minute: 540 });
    await sim().set(10);
    await sim().advance({ minutes: 90 });
    expect(clockNow(trace())).toEqual(sim().now());
    sim().reset();
    expect(clockNow(trace())).toEqual({ day: 0, minute: 540 });
  });
});

describe("stepsRunning", () => {
  it("is true from a step's start until its output, and false after", async () => {
    const { orchestrator, store, trace } = setup();
    let during = false;
    const watcher: Agent<null, typeof Count> = {
      name: "scout",
      output: Count,
      async run() {
        during = stepsRunning(trace());
        return { found: 1 };
      },
    };
    await orchestrator.runStep("s_1", watcher, null);

    expect(during).toBe(true);
    expect(stepsRunning(trace())).toBe(false);
    // A decision outside any step, such as the coach resetting its ladder, is finished work.
    createTracer(store, "s_1").emit({
      agent: "coach",
      kind: "decision",
      summary_ar: "أنهيتَ عودتك، فبدأ المدرب العدّ من جديد من اليوم ١٠",
      summary_en: "Ladder reset for l_omar",
    });
    expect(stepsRunning(trace())).toBe(false);
  });

  it("is false once a step gives up after its retry", async () => {
    const { orchestrator, trace } = setup();
    await expect(
      orchestrator.runStep("s_1", scout([{ found: "three" }, { found: "four" }]), null),
    ).rejects.toThrow();

    expect(stepsRunning(trace())).toBe(false);
  });
});
