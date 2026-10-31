import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Type from "typebox";
import { describe, expect, it } from "vitest";
import { parseModels } from "../providers/models";
import { createProvider } from "../providers/provider";
import { createFileStore } from "../store/store";
import type { TraceEvent } from "../trace/trace";
import { type Agent, createOrchestrator, StepFailed } from "./orchestrator";

// A real (redacted) structured-output response from spike #7.
const PROFILE_RESPONSE = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../docs/spikes/api-access.results.json"), "utf8"),
  ) as { feature: string; endpoint: string; raw: unknown }[]
).find((r) => r.feature === "json_schema" && r.endpoint === "/responses")?.raw;

const MODELS = parseModels(`
roles:
  agent_default: {provider: meta, model: muse-spark-1.3}
prices:
  muse-spark-1.3: {input: 1.25, cached_input: 0.15, output: 4.25}
`);

const Profile = Type.Object(
  {
    goal: Type.String(),
    hours_per_week: Type.Integer(),
    level: Type.Unsafe<string>({ type: "string", enum: ["beginner", "intermediate", "advanced"] }),
  },
  { additionalProperties: false },
);
const Plan = Type.Object({ weeks: Type.Integer() }, { additionalProperties: false });

const intake: Agent<string, typeof Profile> = {
  name: "intake",
  output: Profile,
  async run(ctx, message) {
    const result = await ctx.provider.structured({
      role: "agent_default",
      trace: {
        agent: "intake",
        summary_ar: "فهم رسالة المتعلم",
        summary_en: "Reading the learner's message",
      },
      input: message,
      schema: { name: "profile", schema: Profile },
    });
    return result.json;
  },
};

const planner: Agent<{ hours_per_week: number }, typeof Plan> = {
  name: "planner",
  output: Plan,
  async run(ctx, profile) {
    ctx.trace({
      kind: "decision",
      summary_ar: "خطة قصيرة لأن الوقت محدود",
      summary_en: "Short plan because time is limited",
    });
    return { weeks: profile.hours_per_week <= 5 ? 2 : 1 };
  },
};

function setup(root = mkdtempSync(join(tmpdir(), "orch-"))) {
  let calls = 0;
  const fetch = (async () => {
    calls++;
    return Response.json(PROFILE_RESPONSE);
  }) as typeof globalThis.fetch;
  const store = createFileStore(root);
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({ models: MODELS, profile: "live", apiKey: "sk-test", fetch, onTrace }),
    clock: { wall: () => new Date("2026-10-28T16:00:00Z"), sim: () => null },
  });
  return { root, store, orchestrator, modelCalls: () => calls };
}

describe("orchestrator", () => {
  it("runs a 2-step pipeline and leaves an ordered, bilingual trace", async () => {
    const { store, orchestrator } = setup();

    const profile = await orchestrator.runStep("s_1", intake, "عندي خمس ساعات");
    const plan = await orchestrator.runStep("s_1", planner, profile);

    expect(plan).toEqual({ weeks: 2 });
    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.map((e) => [e.id, e.agent, e.kind])).toEqual([
      ["evt_0001", "intake", "decision"],
      ["evt_0002", "intake", "model_call"],
      ["evt_0003", "intake", "output"],
      ["evt_0004", "planner", "decision"],
      ["evt_0005", "planner", "decision"],
      ["evt_0006", "planner", "output"],
    ]);
    for (const e of events) {
      expect(e).toMatchObject({ session_id: "s_1", ts: "2026-10-28T16:00:00.000Z" });
      expect(e.summary_ar).toMatch(/[؀-ۿ]/);
      expect(e.summary_en).toMatch(/[A-Za-z]/);
    }
    expect(events[1]).toMatchObject({
      model: "muse-spark-1.3",
      cost_usd: expect.closeTo(0.0035235, 6),
      latency_ms: expect.any(Number),
    });
    const output = events[2];
    expect(output?.payload_ref).toMatch(/^blob_/);
    expect(store.readBlob("s_1", output?.payload_ref ?? "")).toEqual(profile);
  });

  it("resumes after a restart without re-running finished steps", async () => {
    const first = setup();
    await first.orchestrator.runStep("s_1", intake, "عندي خمس ساعات");

    const restarted = setup(first.root);
    const profile = await restarted.orchestrator.runStep("s_1", intake, "عندي خمس ساعات");
    await restarted.orchestrator.runStep("s_1", planner, profile);

    expect(profile).toMatchObject({ hours_per_week: 5 });
    expect(restarted.modelCalls()).toBe(0);
    const ids = restarted.store.readTrace("s_1").map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every step of a session that ran at the same time as another", async () => {
    const first = setup();
    await Promise.all([
      first.orchestrator.runStep("s_1", intake, "عندي خمس ساعات", { key: "intake:1" }),
      first.orchestrator.runStep("s_1", intake, "صار عندي ثلاث ساعات", { key: "intake:2" }),
    ]);

    const restarted = setup(first.root);
    await restarted.orchestrator.runStep("s_1", intake, "عندي خمس ساعات", { key: "intake:1" });
    await restarted.orchestrator.runStep("s_1", intake, "صار عندي ثلاث ساعات", { key: "intake:2" });

    expect(first.modelCalls()).toBe(2);
    expect(restarted.modelCalls()).toBe(0);
  });

  it("runs the same agent again under a different step key", async () => {
    const { orchestrator, modelCalls } = setup();

    await orchestrator.runStep("s_1", intake, "عندي خمس ساعات", { key: "intake:1" });
    await orchestrator.runStep("s_1", intake, "صار عندي ثلاث ساعات", { key: "intake:2" });
    await orchestrator.runStep("s_1", intake, "صار عندي ثلاث ساعات", { key: "intake:2" });

    expect(modelCalls()).toBe(2);
  });

  it("keeps a session-wide running cost total in the trace, across restarts", async () => {
    const first = setup();
    await first.orchestrator.runStep("s_1", intake, "a", { key: "intake:1" });
    await first.orchestrator.runStep("s_1", intake, "b", { key: "intake:2" });
    const restarted = setup(first.root);
    await restarted.orchestrator.runStep("s_1", intake, "c", { key: "intake:3" });

    const totals = restarted.store
      .readTrace<TraceEvent>("s_1")
      .filter((e) => e.kind === "model_call")
      .map((e) => e.total_cost_usd);
    expect(totals).toEqual([
      expect.closeTo(0.0035235, 6),
      expect.closeTo(2 * 0.0035235, 6),
      expect.closeTo(3 * 0.0035235, 6),
    ]);
  });
});

describe("guardrail", () => {
  const flaky = (outputs: unknown[]): Agent<null, typeof Plan> & { feedback: unknown[] } => {
    const feedback: unknown[] = [];
    return {
      name: "planner",
      output: Plan,
      feedback,
      async run(ctx) {
        feedback.push(ctx.feedback);
        const next = outputs.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    };
  };

  it("retries an invalid output once, telling the agent what was wrong", async () => {
    const { store, orchestrator } = setup();
    const agent = flaky([{ weeks: "two" }, { weeks: 2 }]);

    await expect(orchestrator.runStep("s_1", agent, null)).resolves.toEqual({ weeks: 2 });
    expect(agent.feedback).toEqual([null, [expect.stringMatching(/^\/weeks/)]]);
    expect(store.readTrace<TraceEvent>("s_1").map((e) => e.kind)).toEqual([
      "decision",
      "error",
      "output",
    ]);
  });

  it("surfaces an error event after the retry also fails, and runs no third attempt", async () => {
    const { store, orchestrator } = setup();
    const agent = flaky([{ weeks: "two" }, new Error("model timed out"), { weeks: 2 }]);

    await expect(orchestrator.runStep("s_1", agent, null)).rejects.toBeInstanceOf(StepFailed);
    expect(agent.feedback).toHaveLength(2);
    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.map((e) => e.kind)).toEqual(["decision", "error", "error"]);
    expect(events.at(-1)?.summary_en).toMatch(/model timed out/);
  });
});
