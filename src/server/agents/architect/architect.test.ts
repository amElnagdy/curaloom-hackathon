import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoursePlan, contractErrors, type PlanDraft } from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { loadConfig } from "../../../config.ts";
import { createOrchestrator, StepFailed } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type ModelResult, type Provider } from "../../providers/provider.ts";
import { createFileCache, createFileStore } from "../../store/store.ts";
import { createPageFetcher } from "../../tools/fetch-page.ts";
import { createTracer, type TraceEvent } from "../../trace/trace.ts";
import { runScout, scoutBrief } from "../scout/scout.ts";
import {
  architectBrief,
  createPlanner,
  limitsOf,
  PlanConflict,
  PlanEditRejected,
  type Planner,
  planFor,
  proposeReplan,
  runArchitect,
  type SavedPlan,
  savedPlan,
} from "./architect.ts";
import type { ReplanRequest } from "./replan.ts";
import { planViolations, weekMinutes } from "./rules.ts";

const seed = loadOmarSeed("Pivot tables in spreadsheets");
// The seed's own texts name Omar, so the learner here has a name found nowhere else.
const profile = { ...seed.profile, name: "سليم" };

// Omar has 5 hours, 300 minutes, a week. The seed's r4 is unverified, so it is not on offer.
const DRAFT: PlanDraft = {
  road: [
    {
      title_ar: "فهم الجدول المحوري",
      weeks: 1,
      lessons: [
        {
          title_ar: "ما الجدول المحوري",
          resource_ids: ["r1"],
          sessions: [
            { day: 4, minutes: 40 },
            { day: 1, minutes: 40 },
          ],
        },
        {
          title_ar: "أول جدول محوري",
          resource_ids: ["r1", "r3"],
          sessions: [{ day: 5, minutes: 40 }],
        },
      ],
    },
    {
      title_ar: "الإحصاء الوصفي",
      weeks: 1,
      lessons: [
        {
          title_ar: "المتوسط والوسيط",
          resource_ids: ["r2"],
          sessions: [
            { day: 8, minutes: 40 },
            { day: 11, minutes: 40 },
          ],
        },
      ],
    },
    { title_ar: "مشروع صغير", weeks: 2, lessons: [] },
  ],
  rationale_ar: "جلسات قصيرة لأنك تركت دورات طويلة من قبل.",
};

// Week 1 holds 4 × 90 = 360 minutes, over Omar's 300.
const TOO_LONG: PlanDraft = {
  ...DRAFT,
  road: [
    {
      title_ar: "فهم الجدول المحوري",
      weeks: 2,
      lessons: [
        {
          title_ar: "ما الجدول المحوري",
          resource_ids: ["r1"],
          sessions: [1, 2, 3, 4].map((day) => ({ day, minutes: 90 })),
        },
      ],
    },
  ],
};

const INVENTED: PlanDraft = {
  ...DRAFT,
  road: [
    {
      title_ar: "فهم الجدول المحوري",
      weeks: 2,
      lessons: [
        { title_ar: "درس", resource_ids: ["r_made_up"], sessions: [{ day: 1, minutes: 30 }] },
      ],
    },
  ],
};

type Call = { role: string; instructions?: string; input: string };

// Answers each structured call with the next draft, the last one once they run out.
function fakeProvider(drafts: PlanDraft[]) {
  const calls: Call[] = [];
  const unused = () => {
    throw new Error("the architect does not use this call");
  };
  const reply = (json: unknown) =>
    ({
      text: JSON.stringify(json),
      json,
      tool_calls: [],
      citations: [],
      image: null,
      usage: { in: 0, out: 0, cost_usd: 0.05 },
      latency_ms: 1,
      model: "fake",
    }) as unknown as ModelResult<never>;
  const provider: Provider = {
    async structured(call) {
      calls.push({ role: call.role, instructions: call.instructions, input: String(call.input) });
      return reply(drafts[Math.min(calls.length, drafts.length) - 1]);
    },
    chat: unused,
    webSearch: unused,
    transcribe: unused,
    imageEdit: unused,
    segment: unused,
    totalCostUsd: () => calls.length * 0.05,
  };
  return { provider, calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(drafts: PlanDraft[]) {
  const dir = mkdtempSync(join(tmpdir(), "architect-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const fake = fakeProvider(drafts);
  const orchestrator = createOrchestrator({ store, makeProvider: () => fake.provider });
  const brief = architectBrief(profile, seed.resources);
  return {
    run: () => runArchitect({ orchestrator, sessionId: "s1", brief }),
    calls: fake.calls,
    trace: () => store.readTrace<TraceEvent>("s1"),
  };
}

describe("architect", () => {
  // The plan page shows the seed's plan as the example before the intake.
  it("keeps the seed's example plan within the rules a built plan keeps", () => {
    const example = seed.plans.at(-1);
    if (!example) throw new Error("the seed has a plan");

    expect(planViolations(example, limitsOf(architectBrief(seed.profile, seed.resources)))).toEqual(
      [],
    );
  });

  it("builds the first version of the plan from the model's draft", async () => {
    const { run } = setup([DRAFT]);

    const plan = await run();

    expect(contractErrors(CoursePlan, plan)).toEqual([]);
    expect(plan).toMatchObject({
      road: [
        { module: "فهم الجدول المحوري", weeks: 1 },
        { module: "الإحصاء الوصفي", weeks: 1 },
        { module: "مشروع صغير", weeks: 2 },
      ],
      committed: {
        start: "day0",
        weeks: 2,
        lessons: [
          { id: "L1", title_ar: "ما الجدول المحوري", module: 0 },
          { id: "L2", title_ar: "أول جدول محوري", module: 0 },
          { id: "L3", title_ar: "المتوسط والوسيط", module: 1 },
        ],
        sessions: [
          { id: "s1", day: 1, minutes: 40, lesson_id: "L1", resource_ids: ["r1"], kind: "study" },
          { id: "s2", day: 4, minutes: 40, lesson_id: "L1", resource_ids: ["r1"], kind: "study" },
          {
            id: "s3",
            day: 5,
            minutes: 40,
            lesson_id: "L2",
            resource_ids: ["r1", "r3"],
            kind: "study",
          },
          { id: "s4", day: 8, minutes: 40, lesson_id: "L3", resource_ids: ["r2"], kind: "study" },
          { id: "s5", day: 11, minutes: 40, lesson_id: "L3", resource_ids: ["r2"], kind: "study" },
        ],
      },
      rationale_ar: "جلسات قصيرة لأنك تركت دورات طويلة من قبل.",
      version: 1,
      reason: "initial",
      diff: [],
      explanation_ar: null,
    });
  });

  it("gives the same plan, id included, for the same draft", async () => {
    const first = await setup([DRAFT]).run();
    const second = await setup([DRAFT]).run();

    expect(second).toEqual(first);
  });

  it("asks the curriculum role, with the learner's weekly minutes and verified resources but not their name", async () => {
    const { run, calls } = setup([DRAFT]);

    await run();

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.role).toBe("curriculum");
    expect(call?.input).toMatch(/300 minutes/);
    expect(call?.input).toMatch(/r1 \|/);
    expect(call?.input).not.toMatch(/r4 \|/);
    expect(call?.input).not.toContain(profile.name);
  });

  it("retries once with the broken rules when the draft is longer than the learner's week", async () => {
    const { run, calls } = setup([TOO_LONG, DRAFT]);

    const plan = await run();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toMatch(/week 1 has 360 minutes/);
    expect(plan.committed.sessions).toHaveLength(5);
  });

  it("fails the step when the model twice names a resource the scout did not find", async () => {
    const { run } = setup([INVENTED]);

    await expect(run()).rejects.toThrow(StepFailed);
    await expect(run()).rejects.toThrow(/r_made_up/);
  });

  it("traces each week's minutes against the learner's time", async () => {
    const { run, trace } = setup([DRAFT]);

    await run();

    expect(trace().filter((e) => e.agent === "architect" && e.kind === "decision")).toContainEqual(
      expect.objectContaining({
        summary_en: expect.stringMatching(/week 1: 120 of 300 minutes, week 2: 80 of 300/),
        summary_ar: expect.stringMatching(/\p{Script=Arabic}/u),
      }),
    );
  });
});

function plannerSetup() {
  const dir = mkdtempSync(join(tmpdir(), "planner-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const fake = fakeProvider([DRAFT]);
  let searches = 0;
  let learner = profile;
  const tracer = createTracer(store, "s1");
  const planner = createPlanner({
    orchestrator: createOrchestrator({ store, makeProvider: () => fake.provider }),
    store,
    tracer,
    sessionId: "s1",
    profile: () => learner,
    findResources: async () => {
      searches++;
      return seed.resources;
    },
  });
  return {
    planner,
    saved: () => savedPlan(store, "s1"),
    // The intake saving a new profile, or restarting and saving another.
    becomes: (next: typeof profile) => {
      learner = next;
    },
    current: () => planFor(store, "s1", learner),
    calls: fake.calls,
    searches: () => searches,
    events: () => store.readTrace<TraceEvent>("s1").filter((e) => e.agent === "architect"),
    trace: () => store.readTrace<TraceEvent>("s1"),
    // The coach passing on the learner's return (#27), with the lessons they passed.
    propose: (request: ReplanRequest, passed: string[]) =>
      proposeReplan({ store, sessionId: "s1", tracer, profile: learner }, request, new Set(passed)),
    // A plan document written before proposals existed.
    writeOld: (plan: Omit<SavedPlan, "pending">) => store.writeDoc("s1", "plan", plan),
  };
}

const refusal = (edit: () => unknown) => {
  try {
    edit();
  } catch (e) {
    return e;
  }
  throw new Error("the edit was accepted");
};

describe("planner", () => {
  it("builds the plan once, from the learner's profile and the resources the scout found", async () => {
    const { planner, saved, calls, searches } = plannerSetup();

    const built = await planner.build();
    const again = await planner.build();

    expect(again).toEqual(built);
    expect(saved()).toEqual(built);
    expect(built.versions.map((v) => [v.version, v.reason])).toEqual([[1, "initial"]]);
    expect(built.resources).toEqual(seed.resources);
    expect(built.limits).toEqual({ budget_minutes: 300, resource_ids: ["r1", "r2", "r3"] });
    expect([calls.length, searches()]).toEqual([1, 1]);
  });

  it("builds again for a new learner instead of answering the plan built for another profile", async () => {
    const { planner, becomes, current, calls } = plannerSetup();
    const first = await planner.build();
    planner.edit({ op: "shorten", session_id: "s1", minutes: 20 });

    becomes({ ...profile, name: "منى", hours_per_week: 2 });
    expect(current()).toBeUndefined();
    const second = await planner.build();

    expect(second.limits.budget_minutes).toBe(120);
    expect(second.versions.map((v) => [v.version, v.reason])).toEqual([[1, "initial"]]);
    expect(current()).toEqual(second);
    expect(calls).toHaveLength(2);
    expect(first.limits.budget_minutes).toBe(300);
  });

  it("refuses an edit to a plan built for another profile", async () => {
    const { planner, becomes } = plannerSetup();
    await planner.build();

    becomes({ ...profile, hours_per_week: 2 });

    expect(
      refusal(() => planner.edit({ op: "shorten", session_id: "s1", minutes: 20 })),
    ).toBeInstanceOf(PlanConflict);
  });

  it("saves an accepted edit as the next version and keeps the one before", async () => {
    const { planner, saved } = plannerSetup();
    await planner.build();

    const edited = planner.edit({ op: "move", session_id: "s2", day: 6 });

    expect(edited.versions.map((v) => [v.version, v.reason])).toEqual([
      [1, "initial"],
      [2, "learner_edit"],
    ]);
    const day = (version: number) =>
      edited.versions[version - 1]?.committed.sessions.find((s) => s.id === "s2")?.day;
    expect([day(1), day(2)]).toEqual([4, 6]);
    expect(saved()).toEqual(edited);
  });

  it("refuses an edit that breaks a rule, with the reasons in Arabic, and keeps the plan", async () => {
    const { planner, saved } = plannerSetup();
    const built = await planner.build();

    const error = refusal(() => planner.edit({ op: "move", session_id: "s2", day: 9 }));

    expect(error).toBeInstanceOf(PlanEditRejected);
    expect((error as PlanEditRejected).violations).toEqual([
      { en: expect.stringMatching(/s2.*day 9/), ar: expect.stringMatching(/\p{Script=Arabic}/u) },
    ]);
    expect(saved()).toEqual(built);
  });

  it("refuses an edit before there is a plan", () => {
    const { planner } = plannerSetup();

    expect(
      refusal(() => planner.edit({ op: "shorten", session_id: "s1", minutes: 20 })),
    ).toBeInstanceOf(PlanConflict);
  });

  it("forgets the plan on reset, then rebuilds it from the saved step without a model call", async () => {
    const { planner, saved, calls } = plannerSetup();
    const built = await planner.build();
    planner.edit({ op: "shorten", session_id: "s1", minutes: 20 });

    planner.reset();
    expect(saved()).toBeUndefined();
    const rebuilt = await planner.build();

    expect(rebuilt).toEqual(built);
    expect(calls).toHaveLength(1);
  });

  it("traces each edit and each refusal as finished work, so the activity feed stops", async () => {
    const { planner, events } = plannerSetup();
    await planner.build();
    const before = events().length;

    planner.edit({ op: "move", session_id: "s2", day: 6 });
    refusal(() => planner.edit({ op: "shorten", session_id: "s3", minutes: 60 }));

    const told = events().slice(before);
    expect(told.map((e) => e.summary_en)).toEqual([
      expect.stringMatching(/moved session s2 from day 4 to day 6; plan version 2/),
      expect.stringMatching(/refused.*s3.*60/),
    ]);
    expect(told.map((e) => e.kind)).toEqual(["output", "output"]);
  });
});

// Back on day 10 with L1 passed, asking for shorter sessions, the recap below the gate on L1.
const SHRINK: ReplanRequest = {
  reason: "shrink",
  today: 10,
  away_days: 10,
  recap: { below_gate: true, review_lesson: "L1" },
};

describe("proposals", () => {
  // DRAFT's weeks have 120 and 80 minutes, so the lighter week's cap is 48: the review of L1 (15)
  // and L2's shortened session (20) fit in it, and L3 waits for day 17.
  it("proposes the next version with the same id, and leaves the versions as they are", async () => {
    const { planner, saved, propose } = plannerSetup();
    const built = await planner.build();

    const proposed = await propose(SHRINK, ["L1"]);

    expect(proposed).toEqual({ ok: true, version: 2, lighter: { minutes: 35, cap: 48 } });
    expect(saved()?.versions).toEqual(built.versions);
    expect(saved()?.pending).toMatchObject({
      id: built.versions[0]?.id,
      version: 2,
      reason: "shrink",
      committed: { start: "day10" },
      explanation_ar: expect.stringMatching(/\p{Script=Arabic}/u),
    });
    expect(saved()?.pending?.diff[0]).toEqual({
      op: "review",
      session: "s6",
      lesson: "L1",
      day: 10,
      minutes: 15,
    });
  });

  it("proposes the same version again for the same return", async () => {
    const { planner, saved, propose } = plannerSetup();
    await planner.build();
    await propose(SHRINK, ["L1"]);
    const first = saved();

    await propose(SHRINK, ["L1"]);

    expect(saved()).toEqual(first);
  });

  it("drops an earlier proposal when a later return needs no change", async () => {
    const { planner, saved, propose } = plannerSetup();
    await planner.build();
    await propose(SHRINK, ["L1"]);

    const proposed = await propose({ ...SHRINK, reason: "comeback" }, ["L1", "L2", "L3"]);

    expect(proposed).toEqual({
      ok: false,
      why: { en: expect.any(String), ar: expect.any(String) },
    });
    expect(saved()?.pending).toBeNull();
  });

  it("makes the proposal the plan's next version when the learner accepts it", async () => {
    const { planner, saved, propose } = plannerSetup();
    const built = await planner.build();
    await propose(SHRINK, ["L1"]);
    const proposal = saved()?.pending;

    const accepted = planner.accept(2);

    expect(accepted.versions).toEqual([...built.versions, proposal]);
    expect(accepted.pending).toBeNull();
    expect(saved()).toEqual(accepted);
  });

  it("keeps the plan as it is when the learner rejects the proposal", async () => {
    const { planner, saved, propose } = plannerSetup();
    const built = await planner.build();
    await propose(SHRINK, ["L1"]);

    const rejected = planner.reject(2);

    expect(rejected).toEqual({ ...built, pending: null });
    expect(saved()).toEqual(rejected);
  });

  it.each([
    ["an accept of another version", (p: Planner) => p.accept(3)],
    ["a reject of another version", (p: Planner) => p.reject(1)],
    [
      "an edit while the proposal waits",
      (p: Planner) => p.edit({ op: "shorten", session_id: "s1", minutes: 20 }),
    ],
  ])("refuses %s, and changes nothing", async (_, act) => {
    const { planner, saved, propose } = plannerSetup();
    await planner.build();
    await propose(SHRINK, ["L1"]);
    const before = saved();

    expect(refusal(() => act(planner))).toBeInstanceOf(PlanConflict);
    expect(saved()).toEqual(before);
  });

  it("refuses an accept or a reject with no proposal waiting", async () => {
    const { planner } = plannerSetup();
    await planner.build();

    expect(refusal(() => planner.accept(2))).toBeInstanceOf(PlanConflict);
    expect(refusal(() => planner.reject(2))).toBeInstanceOf(PlanConflict);
  });

  it("reads a plan saved before proposals existed as having none waiting", async () => {
    const { planner, saved, writeOld } = plannerSetup();
    const { pending: _, ...old } = await planner.build();
    writeOld(old);

    expect(saved()?.pending).toBeNull();
    expect(planner.edit({ op: "shorten", session_id: "s1", minutes: 20 }).versions).toHaveLength(2);
  });

  it("traces the proposal and each answer to it, with the explanation from the template", async () => {
    const { planner, propose, trace } = plannerSetup();
    await planner.build();
    const before = trace().length;

    await propose(SHRINK, ["L1"]);
    planner.reject(2);
    await propose(SHRINK, ["L1"]);
    planner.accept(2);

    expect(
      trace()
        .slice(before)
        .map((e) => [e.agent, e.kind, e.summary_en]),
    ).toEqual([
      [
        "replanner",
        "decision",
        "replan: v2 (shrink): lighter week 35/48 (60% of 80), 2 missed, 3 moved, 3 shortened, review L1 day 10, module 0 1->2 weeks",
      ],
      ["replanner", "decision", "replan v2: explanation from the template, no model call"],
      ["replanner", "output", "Proposed plan version 2 (shrink)"],
      ["architect", "output", "Learner kept plan version 1; rejected version 2"],
      ["replanner", "decision", expect.stringMatching(/^replan: v2 \(shrink\)/)],
      ["replanner", "decision", "replan v2: explanation from the template, no model call"],
      ["replanner", "output", "Proposed plan version 2 (shrink)"],
      ["architect", "output", "Learner accepted plan version 2 (shrink)"],
    ]);
    expect(
      trace()
        .slice(before)
        .map((e) => e.summary_ar),
    ).toEqual(
      expect.arrayContaining([
        "اقترح مُعيد التخطيط النسخة ٢ من خطتك",
        "أبقيتَ خطتك كما هي",
        "اعتمدتَ النسخة ٢ من خطتك",
      ]),
    );
  });
});

// The scout's recorded topic: the plan is recorded on its recorded resources. RECORD_FIXTURES is a
// test-only switch, as in contracts/smoke.test.ts: re-record with `pnpm fixtures:record`.
const RECORDED_TOPIC = "Excel pivot tables for data analysis";
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

describe("architect, replaying the recorded plan", () => {
  it("plans Omar's two weeks within his time, from the scout's recorded resources, on Wonder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "architect-replay-"));
    dirs.push(dir);
    const store = createFileStore(dir);
    const orchestrator = createOrchestrator({
      store,
      makeProvider: (onTrace) =>
        createProvider({
          models: loadModels(),
          profile: recording ? "record" : "replay",
          apiKey: recording ? loadConfig(process.env).modelApiKey : undefined,
          onTrace,
        }),
    });
    const pages = createPageFetcher({
      profile: "replay",
      userAgent: "test",
      transport: async () => {
        throw new Error("replay must not touch the network");
      },
    });
    const cache = createFileCache(dir);
    const planner = createPlanner({
      orchestrator,
      store,
      tracer: createTracer(store, "s1"),
      sessionId: "s1",
      profile: () => ({ ...seed.profile, topic: RECORDED_TOPIC }),
      findResources: async (learner) =>
        (
          await runScout({
            orchestrator,
            sessionId: "s1",
            brief: scoutBrief(learner),
            pages,
            cache,
          })
        ).resources,
    });

    const { versions, resources, limits } = await planner.build();

    const [plan] = versions;
    if (!plan) throw new Error("no plan");
    expect(planViolations(plan, limits)).toEqual([]);
    expect(Math.max(...weekMinutes(plan))).toBeLessThanOrEqual(5 * 60);
    const found = new Set(resources.map((r) => r.id));
    for (const session of plan.committed.sessions) {
      expect(session.resource_ids.length).toBeGreaterThan(0);
      for (const id of session.resource_ids) expect(found).toContain(id);
    }
    expect(plan.road.length).toBeGreaterThanOrEqual(2);
    expect(plan.rationale_ar).toMatch(/\p{Script=Arabic}/u);
    const models = store
      .readTrace<TraceEvent>("s1")
      .filter((e) => e.agent === "architect" && e.kind === "model_call")
      .map((e) => e.model);
    expect(models).toEqual(["muse-wonder-1.0"]);
  }, 300_000);
});
