import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contractErrors,
  type Diagnostic,
  type IntakeReply,
  LearnerProfile,
} from "../../../../contracts/index.ts";
import { loadConfig } from "../../../config.ts";
import { createOrchestrator, StepFailed } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type ModelResult, type Provider } from "../../providers/provider.ts";
import { createFileCache, createFileStore } from "../../store/store.ts";
import { createPageFetcher } from "../../tools/fetch-page.ts";
import { createTracer, type TraceEvent } from "../../trace/trace.ts";
import { createPlanner } from "../architect/architect.ts";
import { planViolations } from "../architect/rules.ts";
import { runScout, scoutBrief } from "../scout/scout.ts";
import { DONT_KNOW } from "./diagnostic.ts";
import { createIntake, IntakeConflict, savedProfile } from "./intake.ts";

const TOPIC = "Excel pivot tables for data analysis";
const LEARNER = { id: "l_omar", name: "عمر" };

type Heard = IntakeReply["heard"];
const NOTHING: Heard = {
  goal: null,
  background: null,
  hours_per_week: null,
  source_langs_ok: null,
  history_notes: null,
};
const EVERYTHING: Heard = {
  goal: "محلل بيانات مبتدئ",
  background: ["accounting", "excel"],
  hours_per_week: 5,
  source_langs_ok: ["en", "ru", "zh", "fr"],
  history_notes: "ترك دورات طويلة",
};
// What the fake model asks for the fields still missing, unless told otherwise.
const MODEL_ASK = "سؤال النموذج";

const question = (n: number) => ({
  prompt_ar: `سؤال ${n}`,
  options_ar: [`صحيح ${n}`, `خطأ ${n}أ`, `خطأ ${n}ب`, `خطأ ${n}ج`],
  answer: `صحيح ${n}`,
});
const DIAGNOSTIC: Diagnostic = { questions: [question(1), question(2), question(3)] };

type Script = {
  // What the model hears from each message the learner sends, in order.
  heard: Heard[];
  // What it asks after each message, in order; MODEL_ASK once these run out.
  asks?: string[];
  // How many quick checks it writes with too few questions before a usable one.
  brokenDiagnostics?: number;
};

function fakeProvider({ heard, asks = [], brokenDiagnostics = 0 }: Script) {
  const inputs: Record<string, string[]> = { IntakeReply: [], Diagnostic: [] };
  const replies = [...heard];
  const questions = [...asks];
  let broken = brokenDiagnostics;
  const provider: Provider = {
    async structured(call) {
      inputs[call.schema.name]?.push(String(call.input));
      const json =
        call.schema.name === "Diagnostic"
          ? broken-- > 0
            ? { questions: DIAGNOSTIC.questions.slice(1) }
            : DIAGNOSTIC
          : ({
              heard: replies.shift() ?? NOTHING,
              dialect: "gulf",
              ack_ar: `الرد ${inputs.IntakeReply?.length}.`,
              ask_ar: questions.shift() ?? MODEL_ASK,
            } satisfies IntakeReply);
      return {
        text: "",
        json,
        tool_calls: [],
        citations: [],
        image: null,
        usage: { in: 0, out: 0, cost_usd: 0.01 },
        latency_ms: 1,
        model: "fake",
      } as unknown as ModelResult<never>;
    },
    chat: unused,
    webSearch: unused,
    transcribe: unused,
    imageEdit: unused,
    segment: unused,
    totalCostUsd: () => 0,
  };
  return { provider, inputs };
}

function unused(): never {
  throw new Error("the intake does not use this call");
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(heard: Heard[] = [EVERYTHING], script: Omit<Script, "heard"> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "intake-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const cache = createFileCache(dir);
  const fake = fakeProvider({ heard, ...script });
  const orchestrator = createOrchestrator({ store, makeProvider: () => fake.provider });
  const intake = (sessionId = "s1") =>
    createIntake({ orchestrator, store, cache, sessionId, learner: LEARNER, topic: TOPIC });
  return { intake, fake, store };
}

describe("intake", () => {
  it("starts by greeting the learner by name, once", () => {
    const { intake } = setup();

    intake().start();
    const view = intake().start();

    expect(view.status).toBe("interview");
    expect(view.turns).toEqual([{ role: "interviewer", text_ar: expect.stringContaining("عمر") }]);
  });

  it("moves on to the quick check once a message gives every field", async () => {
    const { intake } = setup([EVERYTHING]);
    intake().start();

    const view = await intake().message("أنا محاسب وأبي أصير محلل بيانات");

    expect(view.status).toBe("diagnostic");
    expect(view.turns.map((t) => t.role)).toEqual(["interviewer", "learner", "interviewer"]);
    expect(view.questions).toHaveLength(3);
    expect(view.questions?.[0]).not.toHaveProperty("answer");
    expect(view.questions?.[0]?.options_ar).toContain(DONT_KNOW);
  });

  it("moves on in its own words, even when the model asked something more", async () => {
    const { intake } = setup([EVERYTHING]);
    intake().start();

    const view = await intake().message("أنا محاسب وأبي أصير محلل بيانات");

    const last = view.turns.at(-1)?.text_ar;
    expect(last).toMatch(/^الرد 1\. .*ثلاثة أسئلة سريعة/);
    expect(last).not.toContain(MODEL_ASK);
  });

  it("asks for the first missing field itself when the model asked nothing", async () => {
    const { intake } = setup([{ ...NOTHING, goal: "محلل بيانات" }, NOTHING], { asks: [""] });
    intake().start();

    const first = await intake().message("أبي أصير محلل بيانات");
    const second = await intake().message("ما أدري");

    expect(first.turns.at(-1)?.text_ar).toMatch(/^الرد 1\. ما عملك الآن/);
    expect(second.turns.at(-1)?.text_ar).toBe(`الرد 2. ${MODEL_ASK}`);
  });

  it("asks again while a field is missing, keeping what earlier messages gave", async () => {
    const { intake } = setup([
      { ...NOTHING, goal: "محلل بيانات مبتدئ", background: ["accounting"] },
      { ...NOTHING, hours_per_week: 5 },
    ]);
    intake().start();

    await intake().message("أبي أصير محلل بيانات");
    const view = await intake().message("خمس ساعات بالأسبوع");

    expect(view.status).toBe("interview");
    expect(view.turns).toHaveLength(5);
    expect(view.turns.flatMap((t) => (t.role === "learner" ? [t.heard] : []))).toEqual([
      ["goal", "background"],
      ["hours_per_week"],
    ]);
    expect(view.heard).toEqual({
      ...NOTHING,
      goal: "محلل بيانات مبتدئ",
      background: ["accounting"],
      hours_per_week: 5,
    });
  });

  it("stops asking after the fourth message, with fields still missing", async () => {
    const { intake } = setup([]);
    intake().start();

    for (const text of ["ما أدري", "يمكن", "مدري", "خلاص"]) await intake().message(text);
    const view = intake().view();

    expect(view?.status).toBe("diagnostic");
    expect(view?.turns.filter((t) => t.role === "interviewer")).toHaveLength(5);
    expect(view?.turns.at(-1)?.text_ar).toMatch(/ثلاثة أسئلة سريعة/);
    expect(view?.turns.at(-1)?.text_ar).not.toContain(MODEL_ASK);
  });

  it("asks the model afresh when a different message follows a failed quick check", async () => {
    const { intake, fake } = setup([EVERYTHING, EVERYTHING], { brokenDiagnostics: 2 });
    intake().start();

    await expect(intake().message("أنا محاسب")).rejects.toThrow(StepFailed);
    const view = await intake().message("أنا محاسب وأبي أصير محلل بيانات");

    expect(fake.inputs.IntakeReply).toHaveLength(2);
    expect(fake.inputs.IntakeReply?.[1]).toContain("أبي أصير محلل بيانات");
    expect(view.status).toBe("diagnostic");
    expect(view.turns.filter((t) => t.role === "learner").map((t) => t.text_ar)).toEqual([
      "أنا محاسب وأبي أصير محلل بيانات",
    ]);
  });

  it("closes with the level and saves a valid profile for the other pages", async () => {
    const { intake, store } = setup([EVERYTHING]);
    intake().start();
    await intake().message("أنا محاسب وأبي أصير محلل بيانات");

    const view = await intake().answer({ q1: "صحيح 1", q2: "صحيح 2", q3: DONT_KNOW });

    expect(view.status).toBe("done");
    expect(view.result?.level).toBe("intermediate");
    expect(view.turns.at(-1)).toEqual({
      role: "interviewer",
      text_ar: expect.stringContaining("متوسط"),
    });
    const profile = savedProfile(store, "s1");
    expect(contractErrors(LearnerProfile, profile)).toEqual([]);
    expect(profile).toEqual({
      id: "l_omar",
      name: "عمر",
      locale: "ar",
      dialect: "gulf",
      goal: "محلل بيانات مبتدئ",
      topic: TOPIC,
      hours_per_week: 5,
      background: ["accounting", "excel"],
      source_langs_ok: ["en", "ru", "zh", "fr"],
      diagnostic: {
        level: "intermediate",
        scores: [
          { question_id: "q1", score: 1 },
          { question_id: "q2", score: 1 },
          { question_id: "q3", score: 0 },
        ],
      },
      history_notes: "ترك دورات طويلة",
    });
  });

  it("fills a field the learner never gave with a default, and notes which", async () => {
    const { intake, store } = setup([
      { ...EVERYTHING, source_langs_ok: null, hours_per_week: null },
    ]);
    intake().start();
    for (const text of ["أبي أصير محلل بيانات", "مدري", "يمكن", "خلاص"]) {
      await intake().message(text);
    }

    await intake().answer({ q1: DONT_KNOW, q2: DONT_KNOW, q3: DONT_KNOW });

    const profile = savedProfile(store, "s1");
    expect(profile?.source_langs_ok).toEqual(["en", "ru", "zh", "fr"]);
    expect(profile?.hours_per_week).toBeGreaterThan(0);
    expect(profile?.history_notes).toMatch(/وقتك في الأسبوع.*لغات المصادر/);
  });

  it("refuses a message during the quick check, and answers before it", async () => {
    const { intake } = setup([{ ...NOTHING, goal: "محلل بيانات" }, EVERYTHING]);
    intake().start();

    await intake().message("أبي أصير محلل بيانات");
    await expect(intake().answer({ q1: DONT_KNOW })).rejects.toThrow(IntakeConflict);
    await intake().message("محاسب، خمس ساعات");
    await expect(intake().message("وبعد؟")).rejects.toThrow(IntakeConflict);
  });

  it("restarts from the greeting after a reset, asking the model afresh", async () => {
    const goalOnly = { ...NOTHING, goal: "محلل بيانات" };
    const { intake, fake, store } = setup([EVERYTHING, goalOnly]);
    intake().start();
    await intake().message("أنا محاسب وأبي أصير محلل بيانات");
    await intake().answer({ q1: DONT_KNOW, q2: DONT_KNOW, q3: DONT_KNOW });

    intake().reset();
    expect(intake().view()).toBeNull();
    expect(savedProfile(store, "s1")).toBeUndefined();
    intake().start();
    const view = await intake().message("أبي أصير محلل بيانات");

    expect(fake.inputs.IntakeReply).toHaveLength(2);
    expect(view.status).toBe("interview");
    expect(view.heard).toEqual(goalOnly);
  });

  it("writes the quick check once per topic, and a new session reads it from the cache", async () => {
    const { intake, fake } = setup([EVERYTHING, EVERYTHING]);
    for (const sessionId of ["s1", "s2"]) {
      intake(sessionId).start();
      await intake(sessionId).message("أنا محاسب وأبي أصير محلل بيانات");
    }

    expect(fake.inputs.Diagnostic).toHaveLength(1);
    expect(intake("s2").view()?.questions).toHaveLength(3);
  });

  it("traces the fields it heard by name, never the learner's words", async () => {
    const { intake, store } = setup([{ ...NOTHING, goal: "محلل بيانات", hours_per_week: 5 }]);
    intake().start();

    await intake().message("اسمي عمر ورقمي ٠٥٥١٢٣٤٥٦٧ وعندي خمس ساعات");

    const summaries = store
      .readTrace<TraceEvent>("s1")
      .flatMap((e) => [e.summary_ar, e.summary_en])
      .join("\n");
    expect(summaries).toMatch(/goal, hours_per_week/);
    expect(summaries).not.toMatch(/٠٥٥١٢٣٤٥٦٧|خمس ساعات/);
  });
});

// The recorded conversation's topic, the same sample topic as the scout's recording: the demo topic
// is not decided. RECORD_FIXTURES is a test-only switch, as in contracts/smoke.test.ts: re-record
// with `pnpm fixtures:record`.
const RECORDED_TOPIC = "Excel pivot tables for data analysis";
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

// Omar, in Gulf dialect. He answers what a first interview asks, whatever the model's wording.
const OMAR = [
  "هلا والله. أنا محاسب بشركة في الرياض من خمس سنين، وأبي أتحول لمحلل بيانات.",
  "أشتغل على الإكسل كل يوم، بس عمري ما سويت تحليل بيانات صدق. وقتي ضيق، تقريبًا خمس ساعات بالأسبوع.",
  "عادي عندي أي لغة دامها توصلني بالعربي. سجلت بكورسات كورسيرا قبل وما كملتها، كانت طويلة وأملّ بسرعة. وبعد لا تطرشون لي رسايل الصبح.",
];

// Omar's recorded interview, up to the profile it saves.
async function interview() {
  const dir = mkdtempSync(join(tmpdir(), "intake-replay-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const cache = createFileCache(dir);
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
  const intake = createIntake({
    orchestrator,
    store,
    cache,
    sessionId: "s1",
    learner: LEARNER,
    topic: RECORDED_TOPIC,
  });

  let view = intake.start();
  for (const text of OMAR) {
    if (view.status !== "interview") break;
    view = await intake.message(text);
  }
  expect(view.status).toBe("diagnostic");
  view = await intake.answer({ q1: DONT_KNOW, q2: DONT_KNOW, q3: DONT_KNOW });
  return { store, cache, orchestrator, view };
}

describe("intake, replaying Omar's recorded interview", () => {
  it("profiles him from Gulf dialect in at most 6 interviewer turns", async () => {
    const { store, view } = await interview();

    expect(view.turns.filter((t) => t.role === "interviewer").length).toBeLessThanOrEqual(6);
    const profile = savedProfile(store, "s1");
    expect(contractErrors(LearnerProfile, profile)).toEqual([]);
    expect(profile).toMatchObject({
      dialect: "gulf",
      hours_per_week: 5,
      source_langs_ok: expect.arrayContaining(["en", "ru", "zh", "fr"]),
      background: expect.arrayContaining(["excel"]),
      diagnostic: { level: "beginner" },
    });
    expect(profile?.history_notes).toMatch(/صباح/);
  }, 300_000);

  // The demo's path: the plan page builds on the profile the interview saved, not on the seed's.
  it("plans his course from the profile his interview saved", async () => {
    const { store, cache, orchestrator } = await interview();
    const pages = createPageFetcher({
      profile: recording ? "record" : "replay",
      userAgent: `${loadConfig(process.env).appName}-scout/0.1 (checks the licence of open learning resources)`,
      transport: recording
        ? undefined
        : async () => {
            throw new Error("replay must not touch the network");
          },
    });
    const planner = createPlanner({
      orchestrator,
      store,
      tracer: createTracer(store, "s1"),
      sessionId: "s1",
      profile: () => {
        const profile = savedProfile(store, "s1");
        if (!profile) throw new Error("the interview saved no profile");
        return profile;
      },
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
    expect(limits.budget_minutes).toBe(5 * 60);
    expect(planViolations(plan, limits)).toEqual([]);
    expect(plan.committed.sessions.length).toBeGreaterThan(0);
    const found = new Set(resources.map((r) => r.id));
    for (const session of plan.committed.sessions) {
      expect(session.resource_ids.length).toBeGreaterThan(0);
      for (const id of session.resource_ids) expect(found).toContain(id);
    }
    const models = store
      .readTrace<TraceEvent>("s1")
      .filter((e) => e.agent === "architect" && e.kind === "model_call")
      .map((e) => e.model);
    // Wonder's first recorded reply broke the rules (no lesson at all); the retry kept them.
    expect(models).toEqual(["muse-wonder-1.0", "muse-wonder-1.0"]);
  }, 600_000);
});
