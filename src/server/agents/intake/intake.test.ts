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
import { createOrchestrator } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type ModelResult, type Provider } from "../../providers/provider.ts";
import { createFileCache, createFileStore } from "../../store/store.ts";
import type { TraceEvent } from "../../trace/trace.ts";
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
  history_notes: "dropped MOOCs that were too long",
};

const question = (n: number) => ({
  prompt_ar: `سؤال ${n}`,
  options_ar: [`صحيح ${n}`, `خطأ ${n}أ`, `خطأ ${n}ب`, `خطأ ${n}ج`],
  answer: `صحيح ${n}`,
});
const DIAGNOSTIC: Diagnostic = { questions: [question(1), question(2), question(3)] };

// The model's replies, in order: each message the learner sends takes the next `heard`.
function fakeProvider(script: Heard[]) {
  const inputs: Record<string, string[]> = { IntakeReply: [], Diagnostic: [] };
  const replies = [...script];
  const provider: Provider = {
    async structured(call) {
      inputs[call.schema.name]?.push(String(call.input));
      const json =
        call.schema.name === "Diagnostic"
          ? DIAGNOSTIC
          : ({
              heard: replies.shift() ?? NOTHING,
              dialect: "gulf",
              reply_ar: `الرد ${inputs.IntakeReply?.length}`,
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

function setup(script: Heard[] = [EVERYTHING]) {
  const dir = mkdtempSync(join(tmpdir(), "intake-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const cache = createFileCache(dir);
  const fake = fakeProvider(script);
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
    expect(view.heard).toEqual({
      ...NOTHING,
      goal: "محلل بيانات مبتدئ",
      background: ["accounting"],
      hours_per_week: 5,
    });
  });

  it("stops asking after the fourth message and tells the model to ask nothing more", async () => {
    const { intake, fake } = setup([]);
    intake().start();

    for (const text of ["ما أدري", "يمكن", "مدري", "خلاص"]) await intake().message(text);
    const view = intake().view();

    expect(view?.status).toBe("diagnostic");
    expect(view?.turns.filter((t) => t.role === "interviewer")).toHaveLength(5);
    expect(fake.inputs.IntakeReply?.at(-1)).toMatch(/last message .* ask nothing more/i);
  });

  it("closes with the level and saves a valid profile for the other pages", async () => {
    const { intake, store } = setup([EVERYTHING]);
    intake().start();
    await intake().message("أنا محاسب وأبي أصير محلل بيانات");

    const view = await intake().answer({ q1: "صحيح 1", q2: "صحيح 2", q3: DONT_KNOW });

    expect(view.status).toBe("done");
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
      history_notes: "dropped MOOCs that were too long",
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
    expect(profile?.history_notes).toMatch(/hours_per_week.*source_langs_ok/);
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
// with `RECORD_FIXTURES=1 pnpm vitest run intake.test` (live, about $0.05).
const RECORDED_TOPIC = "Excel pivot tables for data analysis";
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

// Omar, in Gulf dialect. He answers what a first interview asks, whatever the model's wording.
const OMAR = [
  "هلا والله. أنا محاسب بشركة في الرياض من خمس سنين، وأبي أتحول لمحلل بيانات.",
  "أشتغل على الإكسل كل يوم، بس عمري ما سويت تحليل بيانات صدق. وقتي ضيق، تقريبًا خمس ساعات بالأسبوع.",
  "عادي عندي أي لغة دامها توصلني بالعربي. سجلت بكورسات كورسيرا قبل وما كملتها، كانت طويلة وأملّ بسرعة. وبعد لا تطرشون لي رسايل الصبح.",
];

describe("intake, replaying Omar's recorded interview", () => {
  it("profiles him from Gulf dialect in at most 6 interviewer turns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "intake-replay-"));
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
    const intake = createIntake({
      orchestrator,
      store,
      cache: createFileCache(dir),
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
    expect(profile?.history_notes).toMatch(/morning/i);
  }, 300_000);
});
