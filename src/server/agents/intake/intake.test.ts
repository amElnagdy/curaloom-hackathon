import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CoursePlan,
  contractErrors,
  type Diagnostic,
  type Diagram,
  type IntakeReply,
  LearnerProfile,
  type Lesson,
  type Quiz,
  type QuizAttempt,
} from "../../../../contracts/index.ts";
import {
  INTAKE_MESSAGES,
  INTAKE_VOICE_CLIP,
  RECORDED_TOPIC,
  recordedShortAnswers,
  SHORT_ANSWERS,
} from "../../../../demo/script.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { loadConfig, type ProviderProfile } from "../../../config.ts";
import { comebackResponse, consentResponse, inboxResponse, simResponse } from "../../clock/http.ts";
import type { CoachDeps } from "../../coach/coach.ts";
import { recordedCoach, sessionSim } from "../../coach/session.ts";
import { createOrchestrator, StepFailed } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import {
  createProvider,
  FIXTURES_DIR,
  type ModelResult,
  type Provider,
} from "../../providers/provider.ts";
import { createFileCache, createFileStore, type Store } from "../../store/store.ts";
import { createPageFetcher } from "../../tools/fetch-page.ts";
import { arabicLineProblems, tracedIn } from "../../trace/arabic-line.ts";
import { createTracer, type TraceEvent } from "../../trace/trace.ts";
import { createPlanner, planFor, type SavedPlan } from "../architect/architect.ts";
import { planResponse } from "../architect/http.ts";
import { noteViolations, type ReplanRequest, replanBrief } from "../architect/replan.ts";
import { planViolations } from "../architect/rules.ts";
import { createDiagramsBuilder, lessonDiagramsBrief, writtenCourse } from "../diagrams/diagrams.ts";
import { diagramImageResponse } from "../diagrams/http.ts";
import { glossaryProblems } from "../diagrams/rules.ts";
import {
  courseOf,
  createExaminer,
  type ExaminerDeps,
  forgetLessonAndQuiz,
  QuizConflict,
  savedQuizzes,
} from "../examiner/examiner.ts";
import { lessonOpen, quizViolations } from "../examiner/rules.ts";
import { createLessonBuilder, LessonLocked, savedLessons } from "../lesson/lesson.ts";
import { wordCount } from "../lesson/rules.ts";
import { runScout, scoutBrief } from "../scout/scout.ts";
import { DONT_KNOW } from "./diagnostic.ts";
import { transcribeResponse } from "./http.ts";
import { createIntake, IntakeConflict, savedProfile, transcribeVoice } from "./intake.ts";

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
// Every Arabic trace line a test here wrote reads as Arabic (#59).
afterEach(() => {
  const traced = dirs.flatMap(tracedIn);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const e of traced) expect(arabicLineProblems(e.summary_ar), e.summary_ar).toEqual([]);
});

function setup(
  heard: Heard[] = [EVERYTHING],
  { recorded, ...script }: Omit<Script, "heard"> & { recorded?: readonly string[] } = {},
  create: typeof createIntake = createIntake,
) {
  const dir = mkdtempSync(join(tmpdir(), "intake-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const cache = createFileCache(dir);
  const fake = fakeProvider({ heard, ...script });
  const orchestrator = createOrchestrator({ store, makeProvider: () => fake.provider });
  const intake = (sessionId = "s1") =>
    create({
      orchestrator,
      store,
      cache,
      sessionId,
      learner: LEARNER,
      topic: RECORDED_TOPIC,
      recorded,
    });
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

  // Replay answers only the recorded text, so the route passes the recorded messages in replay.
  it("sends the recorded message in place of other text at its place, and marks the turn", async () => {
    const { intake, fake, store } = setup([{ ...NOTHING, goal: "محلل بيانات" }, EVERYTHING], {
      recorded: ["الرسالة المسجّلة الأولى", "الرسالة المسجّلة الثانية"],
    });
    intake().start();

    await intake().message("نص آخر كتبه المتعلم");
    const view = await intake().message("الرسالة المسجّلة الثانية");

    expect(fake.inputs.IntakeReply?.[0]).toContain("Learner: الرسالة المسجّلة الأولى");
    expect(fake.inputs.IntakeReply?.join("\n")).not.toContain("نص آخر كتبه المتعلم");
    expect(view.turns.filter((t) => t.role === "learner")).toEqual([
      { role: "learner", text_ar: "الرسالة المسجّلة الأولى", heard: ["goal"], replaced: true },
      expect.not.objectContaining({ replaced: true }),
    ]);
    const decisions = store
      .readTrace<TraceEvent>("s1")
      .filter((e) => /^Replay: sent recorded message/.test(e.summary_en));
    expect(decisions.map((e) => e.summary_en)).toEqual([
      "Replay: sent recorded message 1 in place of the learner's, which has no recording",
    ]);
  });

  it("sends the learner's own text outside replay", async () => {
    const { intake, fake } = setup([EVERYTHING]);
    intake().start();

    const view = await intake().message("نص آخر كتبه المتعلم");

    expect(fake.inputs.IntakeReply?.[0]).toContain("Learner: نص آخر كتبه المتعلم");
    expect(view.turns[1]).toEqual({
      role: "learner",
      text_ar: "نص آخر كتبه المتعلم",
      heard: expect.any(Array),
    });
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
      topic: RECORDED_TOPIC,
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

// The intake as a server in `mode` runs it: config is read once, when the modules load.
async function intakeIn(mode: ProviderProfile) {
  vi.stubEnv("PROVIDER_PROFILE", mode);
  vi.resetModules();
  return (await import("./intake.ts")).createIntake;
}

const ALL_RIGHT = { q1: "صحيح 1", q2: "صحيح 2", q3: "صحيح 3" };
const NONE_KNOWN = { q1: DONT_KNOW, q2: DONT_KNOW, q3: DONT_KNOW };

describe("intake, in replay (#55)", () => {
  afterEach(() => vi.unstubAllEnvs());

  // A server in `mode`: one message, then the quick check answered as given. Returns the view and
  // what the intake traced as it closed.
  async function closed(mode: ProviderProfile, answers: Record<string, string>) {
    const { intake, store } = setup([EVERYTHING], {}, await intakeIn(mode));
    intake().start();
    await intake().message("أنا محاسب وأبي أصير محلل بيانات");
    const before = store.readTrace<TraceEvent>("s1").length;
    const view = await intake().answer(answers);
    const decisions = store
      .readTrace<TraceEvent>("s1")
      .slice(before)
      // The intake's own decisions, not the orchestrator's start of the step.
      .filter((e) => e.kind === "decision" && !e.summary_en.startsWith("Starting step"))
      .map(({ summary_ar, summary_en }) => ({ summary_ar, summary_en }));
    return { view, decisions, reread: intake().view(), store };
  }

  it("closes on a level with no recordings with the level alone, and a note of the app's under it", async () => {
    const { view, reread, store } = await closed("replay", ALL_RIGHT);

    expect(view.turns.at(-1)?.text_ar).toBe("شكرًا يا عمر، اكتملت المقابلة. مستواك الآن: متقدم.");
    expect(view.level_note_ar).toBe(
      "تُبنى خطتك في هذا العرض المسجّل على مسار المبتدئ، أما خارج العرض فيبنيها التطبيق على مستواك.",
    );
    expect(reread?.level_note_ar).toBe(view.level_note_ar);
    expect(savedProfile(store, "s1")?.diagnostic.level).toBe("advanced");
  });

  it("closes the recorded beginner's interview as before, with no note", async () => {
    const { view } = await closed("replay", NONE_KNOWN);

    expect(view.turns.at(-1)?.text_ar).toBe(
      "شكرًا يا عمر، اكتملت المقابلة. مستواك الآن: مبتدئ، فتبدأ خطتك من الأساسيات.",
    );
    expect(view.level_note_ar).toBeNull();
  });

  it("traces once that the recorded demo plans a level with no recordings on the beginner's path (#88)", async () => {
    const { decisions } = await closed("replay", { ...ALL_RIGHT, q3: DONT_KNOW });

    expect(decisions).toEqual([
      {
        summary_ar: "الاختبار القصير: 2 من 3، والمستوى متوسط",
        summary_en: "Quick check: 2 of 3 right; level intermediate",
      },
      {
        summary_ar: "يبني العرض المسجّل خطتك على مسار المبتدئ، لا على مستواك المتوسط",
        summary_en:
          "Replay has no recordings for level intermediate, so the recorded demo plans on the beginner path; the profile keeps intermediate",
      },
    ]);
  });

  it.each([
    ["replay", "a beginner", NONE_KNOWN, "الاختبار القصير: 0 من 3، والمستوى مبتدئ"],
    ["live", "an advanced learner", ALL_RIGHT, "الاختبار القصير: 3 من 3، والمستوى متقدم"],
    ["record", "an advanced learner", ALL_RIGHT, "الاختبار القصير: 3 من 3، والمستوى متقدم"],
  ] as const)(
    "in %s, plans %s on their own level: no swap traced, and no note",
    async (mode, _learner, answers, quickCheck) => {
      const { view, decisions } = await closed(mode, answers);

      expect(decisions.map((d) => d.summary_ar)).toEqual([quickCheck]);
      expect(view.level_note_ar).toBeNull();
    },
  );
});

// The recorded run's topic and Omar's words come from demo/script.ts, which the replayed pages offer
// the presenter. RECORD_FIXTURES is a test-only switch, as in contracts/smoke.test.ts: re-record
// with `pnpm fixtures:record`.
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

// Omar's recorded interview, up to the profile it saves. With `say`, the learner types other words
// and the intake stands the recorded ones in, as the replay route does.
async function interview(say: readonly string[] = INTAKE_MESSAGES) {
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
    recorded: say === INTAKE_MESSAGES ? undefined : INTAKE_MESSAGES,
  });

  let view = intake.start();
  for (const text of say) {
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

  it("profiles him the same way when he types other words, which have no recording", async () => {
    const { store, view } = await interview(INTAKE_MESSAGES.map((_, i) => `كلام آخر ${i + 1}`));

    expect(savedProfile(store, "s1")?.diagnostic).toMatchObject({ level: "beginner" });
    const learner = view.turns.filter((t) => t.role === "learner");
    expect(learner.map((t) => t.text_ar)).toEqual(INTAKE_MESSAGES.slice(0, learner.length));
    expect(learner.every((t) => t.replaced)).toBe(true);
  }, 300_000);

  // The demo's path: the plan page builds on the profile the interview saved, not on the seed's.
  it("plans his course from the profile his interview saved", async () => {
    const { store, saved } = await planned();

    const { versions, resources, limits } = saved;
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
    // Wonder's first reply in this recording broke the rules and the retry kept them; a re-record
    // may need one attempt or two.
    expect(modelsOf(store, "architect").length).toBeGreaterThan(0);
    expect(new Set(modelsOf(store, "architect"))).toEqual(new Set(["muse-wonder-1.0"]));
  }, 600_000);

  // The afterEach above checks their Arabic lines against the rule (#59).
  it.each([
    ["it cannot read", async (url: string) => ({ ok: false as const, url, reason: "HTTP 503" })],
    [
      "whose licence it no longer finds",
      async (url: string) => ({
        ok: true as const,
        page: {
          url,
          final_url: url,
          status: 200,
          content_type: "text/html",
          truncated: false,
          text: "All rights reserved.",
        },
      }),
    ],
  ])(
    "names a source %s by its site in the Arabic trace, and by its id in English",
    async (_, fetchPage) => {
      const { store, orchestrator, saved } = await planned();
      const builder = createLessonBuilder({
        orchestrator,
        store,
        sessionId: "s1",
        pages: { fetchPage },
        profile: () => savedProfile(store, "s1") as LearnerProfile,
        mastery: () => [],
      });
      const first = (saved.versions[0] as CoursePlan).committed.lessons[0]?.id ?? "";

      await expect(builder.build(first)).rejects.toThrow(StepFailed);
      const unquoted = store
        .readTrace<TraceEvent>("s1")
        .filter((e) => e.agent === "lesson_builder" && e.summary_en.startsWith("Not quoting"));
      expect(unquoted.length).toBeGreaterThan(0);
      for (const e of unquoted) {
        expect(e.summary_en).toMatch(/r_[0-9a-f]{8}/);
        expect(e.summary_ar).toMatch(/\.(wikipedia|wikibooks)\.org/);
      }
    },
    600_000,
  );

  // The lesson page asks for the quiz while Omar reads lesson 1.
  it("writes the quiz for his first lesson", async () => {
    const { store, examiner, first, lesson } = await quizzed();

    const quiz = (await examiner.quiz(first)).quizzes[0] as Quiz;

    expect(quizViolations(quiz, lesson.glossary_ids)).toEqual([]);
    expect(new Set(modelsOf(store, "examiner"))).toEqual(new Set(["muse-spark-1.3"]));
  }, 600_000);

  it("shows lesson 1's VisiCalc screenshot with an Arabic legend once both relabelled samples fail", async () => {
    const course = await quizzed();

    const diagrams = await diagramsOf(course).build(course.first);

    const diagram = expectDiagram(course, course.first, diagrams, "Visicalc.png");
    expect(diagram).toMatchObject({ method: "legend", output: null, check: { attempts: 2 } });
    expect(diagram.check.problems).not.toEqual([]);
    // The recorded reading gave "BUZZ CUT" as «قصة قصيرة», a short story (#38). The override table
    // corrects the legend without a re-record, so the recorded edits keep the reading's Arabic.
    expect(diagram.labels).toContainEqual(
      expect.objectContaining({ src: "BUZZ CUT", ar: "قَصّة شعر قصيرة" }),
    );
    expect(overridesTraced(course.store)).toEqual([
      'Visicalc.png: the override table corrects "BUZZ CUT" from «قصة قصيرة» to the approved «قَصّة شعر قصيرة»',
    ]);
  }, 600_000);

  it("keeps his second lesson shut below 80%, then opens it once he passes a quiz with other questions", async () => {
    const { examiner, builder, first, second, lesson, lessonIds } = await quizzed();
    const quiz = (await examiner.quiz(first)).quizzes[0] as Quiz;

    // He misses one multiple-choice item and explains half of the last short answer.
    const missed = quiz.items.filter((i) => i.type === "mcq")[1];
    const answers = answersTo(quiz, OMAR_FIRST, missed?.id);
    const below = await examiner.attempt(first, quiz.id, answers);
    // Its keys are shown with the grades, so the quiz takes no other attempt.
    expect((await examiner.attempt(first, quiz.id, answers)).attempt).toEqual(below.attempt);
    await expect(examiner.attempt(first, quiz.id, answersTo(quiz, OMAR_FIRST))).rejects.toThrow(
      QuizConflict,
    );
    const retry = (await examiner.quiz(first)).quizzes[1] as Quiz;

    expect(below.attempt.passed).toBe(false);
    expect(below.attempt.score).toBeLessThan(0.8);
    expect(lessonOpen(lessonIds, below.mastery ? [below.mastery] : [], second)).toBe(false);
    await expect(builder.build(second)).rejects.toThrow(LessonLocked);
    expect(quizViolations(retry, lesson.glossary_ids)).toEqual([]);
    const asked = new Set(quiz.items.map((i) => i.prompt_ar));
    expect(retry.items.filter((i) => asked.has(i.prompt_ar))).toEqual([]);

    const passed = await examiner.attempt(first, retry.id, answersTo(retry, OMAR_RETRY));

    expect(passed.attempt.passed).toBe(true);
    expect(passed.mastery).toMatchObject({ passed: true, attempts: 2 });
    expect(lessonOpen(lessonIds, passed.mastery ? [passed.mastery] : [], second)).toBe(true);
    expect((await builder.build(second)).lessons[second]).toBeDefined();
    for (const answer of passed.attempt.answers) {
      expect(answer.feedback_ar).toMatch(/\p{Script=Arabic}/u);
    }
  }, 600_000);

  it("grades the recorded short answers when he writes his own, and passes a retry he got wrong", async () => {
    const { examiner, builder, first, second } = await quizzed(recordedShortAnswers);
    const own = ["كتبتها بكلماتي", "وهذه أيضًا"];
    const quiz = (await examiner.quiz(first)).quizzes[0] as Quiz;
    const missed = quiz.items.filter((i) => i.type === "mcq")[1];

    const below = await examiner.attempt(first, quiz.id, answersTo(quiz, own, missed?.id));
    const retry = (await examiner.quiz(first)).quizzes[1] as Quiz;
    const wrong = new Set(
      retry.items
        .filter((i) => i.type === "mcq")
        .slice(0, 2)
        .map((i) => i.id),
    );
    const passed = await examiner.attempt(
      first,
      retry.id,
      answersTo(retry, own).map((a) => {
        const item = retry.items.find((i) => i.id === a.item_id);
        const other = item?.options_ar.find((o) => o !== item.answer);
        return wrong.has(a.item_id) && other ? { ...a, response: other } : a;
      }),
    );

    const shortsOf = (attempt: QuizAttempt, q: Quiz) =>
      attempt.answers
        .filter((a) => q.items.find((i) => i.id === a.item_id)?.type === "short")
        .map((a) => a.response);
    expect(shortsOf(below.attempt, quiz)).toEqual(OMAR_FIRST);
    expect(below.attempt.passed).toBe(false);
    expect(shortsOf(passed.attempt, retry)).toEqual(OMAR_RETRY);
    expect(passed.attempt).toMatchObject({ passed: true, score: 1 });
    expect((await builder.build(second)).lessons[second]).toBeDefined();
  }, 600_000);

  // The plan page starts the first lesson once the plan is ready; the second opens once he passes the
  // first's quiz, and shares its glossary.
  it("writes his second lesson once he passes the first, one glossary for both", async () => {
    const { store, builder, saved, first, second } = await passedFirst();
    const plan = saved.versions[0] as CoursePlan;

    const afterFirst = await builder.build(first);
    const afterSecond = await builder.build(second);

    for (const id of [first, second]) {
      const lesson = afterSecond.lessons[id] as Lesson;
      const resources = new Set(
        plan.committed.sessions.filter((s) => s.lesson_id === id).flatMap((s) => s.resource_ids),
      );
      expect(lesson.sections.length).toBeGreaterThanOrEqual(3);
      for (const { source_excerpt: excerpt } of lesson.sections) {
        expect(resources).toContain(excerpt.resource_id);
        expect(wordCount(excerpt.text)).toBeLessThanOrEqual(300);
        expect(excerpt.locator).not.toBe("");
      }
      expect(lesson.glossary_ids.length).toBeGreaterThanOrEqual(5);
      const quoted = new Set(lesson.sections.map((s) => s.source_excerpt.lang));
      for (const term of afterSecond.glossary.filter((e) => lesson.glossary_ids.includes(e.id))) {
        expect(quoted).toContain(term.src.lang);
      }
      expect(afterSecond.glossary.map((e) => e.id)).toEqual(
        expect.arrayContaining(lesson.glossary_ids),
      );
    }
    // The second lesson leaves the first's entries as they were, and each source term has one entry.
    expect(afterSecond.glossary.slice(0, afterFirst.glossary.length)).toEqual(afterFirst.glossary);
    const terms = afterSecond.glossary.map((e) => `${e.src.lang}:${e.src.term.toLowerCase()}`);
    expect(new Set(terms).size).toBe(terms.length);
    expect(new Set(modelsOf(store, "lesson_builder"))).toEqual(new Set(["muse-spark-1.3"]));
  }, 600_000);

  // The lesson page asks for lesson 2's quiz once he opens it.
  it("relabels lesson 2's pivot table into Arabic once it opens, and serves Muse Image's bytes as they came", async () => {
    const course = await passedFirst();
    await course.builder.build(course.second);

    const diagrams = await diagramsOf(course).build(course.second);

    const diagram = expectDiagram(course, course.second, diagrams, "Pivottable-Pivoted.PNG");
    expectRelabelled(diagram);
    expect(overridesTraced(course.store)).toEqual([]);
    const ref = diagram.output?.ref ?? "";
    const served = diagramImageResponse(course.store, "s1", course.second, ref);
    expect(served.headers.get("content-type")).toBe("image/webp");
    // Byte for byte, so the provenance metadata Meta put in the image reaches the browser.
    expect(recordedEdits()).toContain(sha256(new Uint8Array(await served.arrayBuffer())));
  }, 600_000);

  it("writes the quiz for his second lesson once it opens", async () => {
    const { store, builder, examiner, second } = await passedFirst();
    const lesson = (await builder.build(second)).lessons[second] as Lesson;

    const quiz = (await examiner.quiz(second)).quizzes[0] as Quiz;

    expect(quiz.lesson_id).toBe(second);
    expect(quizViolations(quiz, lesson.glossary_ids)).toEqual([]);
    expect(new Set(modelsOf(store, "examiner"))).toEqual(new Set(["muse-spark-1.3"]));
  }, 600_000);

  // The coach page's path after the intake: he passed lesson 1 on day 0 and studies no more. His
  // consent is the consent screen's default with messages on. His «جلسات أقصر» waits for his
  // comeback (#27), so the plan stays v1.
  it("chases him in Spark's words to the day-10 check-in, where «جلسات أقصر» is recorded", async () => {
    const { store, orchestrator, saved } = await passedFirst();
    const sim = () => sessionSim(store, "s1", loadOmarSeed(RECORDED_TOPIC), orchestrator).sim;
    sim().setConsent({
      messages: true,
      quiet_hours: { start: "22:00", end: "08:00" },
      intensity: "gentle",
    });

    const fired = [];
    for (const day of [2, 5, 10]) fired.push(...(await sim().set(day)).events);
    const answer = await sim().answer({
      event_id: "checkin_a0_d10",
      choice: "shrink",
      pause_days: 7,
    });

    expect(fired.map((e) => [e.id, e.status])).toEqual([
      ["nudge_a0_d2", "sent"],
      ["replan_a0_d5", "sent"],
      ["checkin_a0_d10", "sent"],
    ]);
    for (const { message_ar } of fired) {
      expect(message_ar.length).toBeLessThanOrEqual(160);
      expect(message_ar.split(LEARNER.name)).toHaveLength(2);
    }
    expect(new Set(modelsOf(store, "coach"))).toEqual(new Set(["muse-spark-1.3"]));
    const fallbacks = store
      .readTrace<TraceEvent>("s1")
      .filter((e) => e.agent === "coach" && /template/.test(e.summary_en));
    expect(fallbacks).toEqual([]);

    expect(answer).toEqual({ choice: "shrink", paused_until: null });
    expect(
      sim()
        .checkinReplies()
        .map((r) => [r.choice, r.anchor]),
    ).toEqual([["shrink", 0]]);
    expect(store.readDoc<SavedPlan>("s1", "plan")?.versions).toEqual(saved.versions);
  }, 600_000);
});

// In replay the coach asks the model only for a wording the recordings have (#55): his recorded
// day-0 run's three messages, in the recorded gentle tone whatever tone he picks. Any other message
// is its template, with no request that replay could not answer.
describe("the coach in replay, which words only the recorded messages", () => {
  const coachTrace = (store: Store) =>
    store.readTrace<TraceEvent>("s1").filter((e) => e.agent === "coach");
  const templated = (store: Store) =>
    coachTrace(store)
      .filter((e) =>
        e.summary_en.endsWith("template, no model call: replay has no recording of its wording"),
      )
      .map((e) => e.summary_en.split(":")[0]);
  const missing = (store: Store) =>
    store.readTrace<TraceEvent>("s1").filter((e) => e.missing_recording);

  it("plays his recorded messages to the check-in, then sends the weekly one after «استراحة أسبوع» as its template", async () => {
    const { store, orchestrator } = await passedFirst();
    const sim = () =>
      sessionSim(store, "s1", loadOmarSeed(RECORDED_TOPIC), orchestrator, recordedCoach()).sim;
    sim().setConsent({ messages: true, quiet_hours: null, intensity: "normal" });

    const fired = [];
    for (const day of [2, 5, 10]) fired.push(...(await sim().set(day)).events);
    await sim().answer({ event_id: "checkin_a0_d10", choice: "pause", pause_days: 7 });
    fired.push(...(await sim().set(17)).events);

    expect(fired.map((e) => [e.id, e.status])).toEqual([
      ["nudge_a0_d2", "sent"],
      ["replan_a0_d5", "sent"],
      ["checkin_a0_d10", "sent"],
      ["weekly_a0_d17", "sent"],
    ]);
    expect(coachTrace(store).filter((e) => e.kind === "model_call")).toHaveLength(3);
    expect(templated(store)).toEqual(["weekly_a0_d17"]);
    expect(missing(store)).toEqual([]);
    expect(sim().comeback()).toMatchObject({ state: "none", held: "paused" });
  }, 600_000);

  it("sends lesson 1's messages as their templates when the clock moves before he passes it", async () => {
    const { store, orchestrator } = await quizzed();
    const sim = () =>
      sessionSim(store, "s1", loadOmarSeed(RECORDED_TOPIC), orchestrator, recordedCoach()).sim;
    sim().setConsent({ messages: true, quiet_hours: null, intensity: "gentle" });

    const { events } = await sim().set(5);

    expect(events.map((e) => [e.id, e.status])).toEqual([
      ["nudge_a0_d2", "sent"],
      ["replan_a0_d5", "sent"],
    ]);
    expect(coachTrace(store).filter((e) => e.kind === "model_call")).toEqual([]);
    expect(templated(store)).toEqual(["nudge_a0_d2", "replan_a0_d5"]);
    expect(missing(store)).toEqual([]);
  }, 600_000);
});

// The demo's path through the HTTP API (#26, #27), as the coach and plan pages post it: Omar, who
// passed lesson 1 on day 0 and has lesson 2 written (unless `secondWritten` is false), gets the
// day-10 check-in and taps `choice`, «جلسات أقصر» or «مصدر آخر»; the plan page sees him back and he
// answers the recap, `right` of five right.
async function cameBack(
  right: number,
  choice: "shrink" | "switch" = "shrink",
  {
    secondWritten = true,
    recorded,
  }: { secondWritten?: boolean; recorded?: CoachDeps["recorded"] } = {},
) {
  const course = await passedFirst();
  const { store, orchestrator, builder, second } = course;
  if (secondWritten) await builder.build(second);
  const seed = loadOmarSeed(RECORDED_TOPIC);
  const deps = { sim: (id: string) => sessionSim(store, id, seed, orchestrator, recorded).sim };
  const post = (body: unknown) =>
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const ok = async (res: Response | Promise<Response>) => {
    const answered = await res;
    expect(answered.status).toBe(200);
    return answered.json();
  };

  await ok(
    consentResponse(
      post({ messages: true, quiet_hours: { start: "22:00", end: "08:00" }, intensity: "gentle" }),
      "s1",
      deps,
    ),
  );
  for (const day of [2, 5, 10]) {
    await ok(simResponse(post({ day }), "s1", "set", { ...deps, enabled: true }));
  }
  const tapped = await ok(inboxResponse(post({ event_id: "checkin_a0_d10", choice }), "s1", deps));
  const v1 = planFor(store, "s1", savedProfile(store, "s1") as LearnerProfile);
  const { comeback } = await ok(comebackResponse(post({}), "s1", "open", deps));
  const keys = new Map(
    savedQuizzes(store, "s1", v1?.versions[0]?.id ?? "").quizzes.flatMap((q) =>
      q.items.map((item) => [`${q.id}:${item.id}`, item]),
    ),
  );
  const answers = comeback.recap.items.map((item: { id: string }, i: number) => {
    const key = keys.get(item.id);
    return {
      item_id: item.id,
      response: i < right ? key?.answer : key?.options_ar.find((o) => o !== key.answer),
    };
  });
  const finished = await ok(
    comebackResponse(post({ quiz_id: comeback.recap.id, answers }), "s1", "recap", deps),
  );
  const planner = createPlanner({
    orchestrator,
    store,
    tracer: createTracer(store, "s1"),
    sessionId: "s1",
    profile: () => savedProfile(store, "s1") as LearnerProfile,
    findResources: async () => {
      throw new Error("the plan is built already");
    },
    forgetLesson: (planId, lessonId) => forgetLessonAndQuiz(store, "s1", planId, lessonId),
  });
  return { ...course, v1, tapped, comeback, finished, planner, post, ok, sim: deps.sim };
}

// Whether Spark wrote the proposed v2's explanation, once, within the rules of its brief, and could
// pick `resource_id` for a switch. The brief is rebuilt from v1, the profile and what the coach
// passed on.
function explainedBySpark(
  store: Store,
  v2: CoursePlan,
  request: ReplanRequest,
  resource_id: string | null = null,
) {
  const profile = savedProfile(store, "s1") as LearnerProfile;
  const saved = planFor(store, "s1", profile) as SavedPlan;
  const [v1] = saved.versions as [CoursePlan];
  const brief = replanBrief(v1, v2, v1, request, new Set(["L1"]), {
    resources: saved.resources,
    history_notes: profile.history_notes,
  });
  const replanner = store.readTrace<TraceEvent>("s1").filter((e) => e.agent === "replanner");
  return {
    models: replanner.filter((e) => e.kind === "model_call").map((e) => e.model),
    fallbacks: replanner.filter((e) => /template/.test(e.summary_en)).map((e) => e.summary_en),
    violations: noteViolations({ explanation_ar: v2.explanation_ar ?? "", resource_id }, brief),
  };
}

describe("the demo's comeback, replaying the recorded course through the HTTP API", () => {
  it("proposes v2 after «جلسات أقصر» and a recap of 3 out of 5, with a review of lesson 1 first, and keeps it on accept", async () => {
    const came = await cameBack(3);
    const { store, v1, tapped, comeback, finished, planner, post, ok, sim, builder, second } = came;
    const proposal = planFor(store, "s1", savedProfile(store, "s1") as LearnerProfile);
    const said = store
      .readTrace<TraceEvent>("s1")
      .filter((e) => (e.agent === "coach" || e.agent === "replanner") && e.kind !== "model_call")
      .map((e) => e.summary_en);
    const ladder = sim("s1").ladder();

    const { plan } = await ok(planResponse(post({ version: 2 }), "s1", "accept", planner));
    const lessons = await builder.build(second);
    const diagrams = await diagramsOf(came).build(second);

    expect(tapped.answer).toEqual({ choice: "shrink", paused_until: null });
    expectRelabelled(expectDiagram(came, second, diagrams, "Pivottable-Pivoted.PNG"));
    expect(comeback).toMatchObject({ state: "open", away_days: 10, reason: "shrink" });
    expect(comeback.recap.items).toHaveLength(5);
    expect(new Set(comeback.recap.items.map((i: { type: string }) => i.type))).toEqual(
      new Set(["mcq"]),
    );
    expect(finished.replanned).toEqual({ ok: true, version: 2, lighter: { minutes: 55, cap: 84 } });
    expect(finished.comeback.last.recap).toMatchObject({
      below_gate: true,
      review_lesson: "L1",
      attempt: { score: 0.6 },
    });
    expect(proposal?.versions).toEqual(v1?.versions);
    const v2 = proposal?.pending;
    expect(v2).toMatchObject({ id: v1?.versions[0]?.id, version: 2, reason: "shrink" });
    expect(v2?.diff).toHaveLength(24);
    expect(v2?.diff[0]).toEqual({
      op: "review",
      session: "s14",
      lesson: "L1",
      day: 10,
      minutes: 15,
    });
    expect(planViolations(v2 as CoursePlan, proposal?.limits as SavedPlan["limits"])).toEqual([]);
    expect(said.filter((s) => /^(comeback_detected|recap_quiz|replan: |active:)/.test(s))).toEqual([
      "comeback_detected: l_omar back after 10 days (via reply)",
      "recap_quiz: graded by code 3/5 (60%), below the 80% gate -> review L1",
      "replan: v2 (shrink): lighter week 55/84 (60% of 140), 7 missed, 11 moved, 11 shortened, review L1 day 10, module 0 1->3 weeks",
      "active: ladder reset on day 10",
    ]);
    expect(said).toContain("Proposed plan version 2 (shrink)");
    expect(
      explainedBySpark(store, v2 as CoursePlan, {
        reason: "shrink",
        today: 10,
        away_days: 10,
        recap: { below_gate: true, review_lesson: "L1" },
      }),
    ).toEqual({ models: ["muse-spark-1.3"], fallbacks: [], violations: [] });
    expect(ladder).toMatchObject({ state: "active", anchor: 10, next: { id: "nudge_a10_d12" } });

    expect(plan.versions.map((v: CoursePlan) => v.version)).toEqual([1, 2]);
    expect(plan.versions[1]).toEqual(v2);
    expect(plan.pending).toBeNull();
    expect(savedQuizzes(store, "s1", v2?.id ?? "").mastery).toContainEqual(
      expect.objectContaining({ lesson_id: "L1", passed: true }),
    );
    expect(lessons.lessons[second]).toBeDefined();
    expect(sim("s1").comeback().state).toBe("none");
  }, 600_000);

  it("proposes v2 with no review after a recap of 5 out of 5", async () => {
    const { store, finished } = await cameBack(5);

    const v2 = planFor(store, "s1", savedProfile(store, "s1") as LearnerProfile)?.pending;

    expect(finished.comeback.last.recap).toMatchObject({ below_gate: false, review_lesson: null });
    expect(finished.replanned).toEqual({ ok: true, version: 2, lighter: { minutes: 50, cap: 84 } });
    expect(v2?.diff).toHaveLength(23);
    expect(v2?.diff.filter((c) => c.op === "review")).toEqual([]);
    expect(
      explainedBySpark(store, v2 as CoursePlan, {
        reason: "shrink",
        today: 10,
        away_days: 10,
        recap: { below_gate: false, review_lesson: null },
      }),
    ).toEqual({ models: ["muse-spark-1.3"], fallbacks: [], violations: [] });
  }, 600_000);

  // Lesson 2 teaches from r_9109c80f and r_8babb86b. The scout's other verified resources rank
  // r_43e79caf (0.95), r_8f7bbb8e (0.94), r_19cfaa64 and r_c167a216 (0.77, by id), r_c61a1e51
  // (0.71) and r_df4da75d (0.61). The day-10 return lays the same days as a plain comeback: the
  // review on day 10 and lesson 2 from day 12, a lighter week of 15 + 3 × 20 = 75 minutes.
  it("proposes v2 after «مصدر آخر» with lesson 2 on Spark's pick, and writes lesson 2 again from it once accepted", async () => {
    const came = await cameBack(3, "switch");
    const { store, v1, tapped, finished, planner, post, ok, builder, examiner, second } = came;
    const untaken = (await examiner.quiz(second)).quizzes;
    const proposal = planFor(store, "s1", savedProfile(store, "s1") as LearnerProfile);
    const v2 = proposal?.pending as CoursePlan;
    const said = store
      .readTrace<TraceEvent>("s1")
      .filter((e) => (e.agent === "coach" || e.agent === "replanner") && e.kind !== "model_call")
      .map((e) => e.summary_en);
    const lessonsBefore = savedLessons(store, "s1", v2);
    const quizzesBefore = savedQuizzes(store, "s1", v2.id);

    const { plan } = await ok(planResponse(post({ version: 2 }), "s1", "accept", planner));
    const lessonsAfter = savedLessons(store, "s1", v2);
    const quizzesAfter = savedQuizzes(store, "s1", v2.id);
    const rewritten = (await builder.build(second)).lessons[second] as Lesson;
    const diagrams = await diagramsOf(came).build(second);

    expect(tapped.answer).toEqual({ choice: "switch", paused_until: null });
    expect(diagrams).toEqual([]);
    expect(finished.replanned).toEqual({ ok: true, version: 2, lighter: { minutes: 75, cap: 84 } });
    expect(proposal?.versions).toEqual(v1?.versions);
    expect(v2).toMatchObject({ id: v1?.versions[0]?.id, version: 2, reason: "switch" });
    expect(v2.diff).toHaveLength(17);
    expect(v2.diff.filter((c) => c.op === "switch")).toEqual(
      ["s3", "s4"].map((session) => ({
        op: "switch",
        session,
        from: ["r_9109c80f", "r_8babb86b"],
        to: [SPARK_PICK],
      })),
    );
    expect(said.filter((s) => /^(comeback_detected|recap_quiz|replan:? |active:)/.test(s))).toEqual(
      [
        "comeback_detected: l_omar back after 10 days (via reply)",
        "recap_quiz: graded by code 3/5 (60%), below the 80% gate -> review L1",
        "replan: v2 (switch): lighter week 75/84 (60% of 140), 7 missed, 11 moved, 2 shortened, 2 switched, review L1 day 10, module 0 1->3 weeks",
        `replan v2: L2 moves to ${SPARK_PICK}, Spark's pick of 6 candidates; code ranked r_43e79caf first`,
        "active: ladder reset on day 10",
      ],
    );
    expect(
      explainedBySpark(
        store,
        v2,
        {
          reason: "switch",
          today: 10,
          away_days: 10,
          recap: { below_gate: true, review_lesson: "L1" },
        },
        SPARK_PICK,
      ),
    ).toEqual({ models: ["muse-spark-1.3"], fallbacks: [], violations: [] });

    expect(plan.versions.map((v: CoursePlan) => v.version)).toEqual([1, 2]);
    expect(Object.keys(lessonsBefore?.lessons ?? {})).toEqual(["L1", second]);
    expect(lessonsAfter).toEqual({
      ...lessonsBefore,
      lessons: { L1: lessonsBefore?.lessons.L1 },
    });
    expect(untaken.map((q) => q.lesson_id)).toEqual([second]);
    expect(quizzesAfter).toEqual({
      ...quizzesBefore,
      quizzes: quizzesBefore.quizzes.filter((q) => q.lesson_id !== second),
    });
    expect(quizzesAfter.mastery).toContainEqual(
      expect.objectContaining({ lesson_id: "L1", passed: true }),
    );
    expect(new Set(rewritten.sections.map((s) => s.source_excerpt.resource_id))).toEqual(
      new Set([SPARK_PICK]),
    );
  }, 600_000);

  // The run has no «مصدر آخر» after a recap at the gate: replay grades the recorded recap in its
  // place, so Spark's recorded note picks the source lesson 2 is written again from (#55).
  it("in replay, re-plans «مصدر آخر» after a 5-of-5 recap from the recorded 3-of-5 one", async () => {
    const came = await cameBack(5, "switch", {
      recorded: recordedCoach(),
    });
    const { store, planner, post, ok, builder, finished, second } = came;
    await ok(planResponse(post({ version: 2 }), "s1", "accept", planner));

    const rewritten = (await builder.build(second)).lessons[second] as Lesson;

    expect(finished.comeback.last.recap).toMatchObject({
      replaced: true,
      below_gate: true,
      attempt: { score: 0.6 },
    });
    expect(
      store
        .readTrace<TraceEvent>("s1")
        .filter((e) => e.agent === "replanner")
        .map((e) => e.summary_en),
    ).toContain(
      `replan v2: L2 moves to ${SPARK_PICK}, Spark's pick of 6 candidates; code ranked r_43e79caf first`,
    );
    expect(new Set(rewritten.sections.map((s) => s.source_excerpt.resource_id))).toEqual(
      new Set([SPARK_PICK]),
    );
  }, 600_000);

  // The lesson page asks for the quiz of lesson 2 as written again from Spark's pick.
  it("writes the quiz for lesson 2 as written again from Spark's pick", async () => {
    const { store, planner, post, ok, builder, examiner, second } = await cameBack(3, "switch");
    await ok(planResponse(post({ version: 2 }), "s1", "accept", planner));
    const lesson = (await builder.build(second)).lessons[second] as Lesson;

    const quiz = (await examiner.quiz(second)).quizzes[0] as Quiz;

    expect(quiz.lesson_id).toBe(second);
    expect(quizViolations(quiz, lesson.glossary_ids)).toEqual([]);
    expect(modelsOf(store, "examiner").at(-1)).toBe("muse-spark-1.3");
  }, 600_000);

  // The plan page writes lesson 2 while the comeback is open, under v1. Should the learner accept v2
  // before that write lands, the lesson page writes lesson 2 under v2's shorter sessions instead.
  it("writes lesson 2 and its quiz under the accepted «جلسات أقصر» v2 when lesson 2 was not written yet", async () => {
    const { store, planner, post, ok, builder, examiner, second } = await cameBack(3, "shrink", {
      secondWritten: false,
    });
    await ok(planResponse(post({ version: 2 }), "s1", "accept", planner));

    const lesson = (await builder.build(second)).lessons[second] as Lesson;
    const quiz = (await examiner.quiz(second)).quizzes[0] as Quiz;

    expect(lesson.sections.length).toBeGreaterThanOrEqual(3);
    expect(quiz.lesson_id).toBe(second);
    expect(quizViolations(quiz, lesson.glossary_ids)).toEqual([]);
    expect(new Set(modelsOf(store, "lesson_builder"))).toEqual(new Set(["muse-spark-1.3"]));
  }, 600_000);

  // A presenter who gets four of the recap's five right lands on the 5-of-5 recording: the brief
  // gives Spark the recap's band, never its score.
  it("explains v2 from the recorded note after a recap of 4 out of 5, at the gate", async () => {
    const { store, finished } = await cameBack(4);

    const v2 = planFor(store, "s1", savedProfile(store, "s1") as LearnerProfile)?.pending;

    expect(finished.comeback.last.recap).toMatchObject({ below_gate: false, review_lesson: null });
    expect(
      explainedBySpark(store, v2 as CoursePlan, {
        reason: "shrink",
        today: 10,
        away_days: 10,
        recap: { below_gate: false, review_lesson: null },
      }),
    ).toEqual({ models: ["muse-spark-1.3"], fallbacks: [], violations: [] });
  }, 600_000);
});

// The resource Spark picked for lesson 2 in the recorded switch: the English step-by-step
// «Microsoft Office/Create a Pivot Table», over the French encyclopedia article code ranks first.
const SPARK_PICK = "r_8f7bbb8e";

// Omar's short answers to lesson 1's first quiz (full credit, then half) and to its retry (full
// credit twice).
const [OMAR_FIRST, OMAR_RETRY] = SHORT_ANSWERS.L1;

// His answers to a quiz: each multiple-choice key, except a wrong option on `miss`, and the given
// short answers in order.
function answersTo(quiz: Quiz, shorts: readonly string[], miss?: string) {
  const left = [...shorts];
  return quiz.items.map((item) => ({
    item_id: item.id,
    response:
      item.type === "short"
        ? (left.shift() ?? "")
        : item.id === miss
          ? (item.options_ar.find((o) => o !== item.answer) as string)
          : item.answer,
  }));
}

// Omar's plan with his first lesson written, and the examiner the lesson page asks. With `recorded`,
// the examiner grades the recorded short answers, as the replay route's does.
async function quizzed(recorded?: ExaminerDeps["recorded"]) {
  const { store, orchestrator, pages, saved } = await planned();
  const profile = () => savedProfile(store, "s1") as LearnerProfile;
  const builder = createLessonBuilder({
    orchestrator,
    store,
    sessionId: "s1",
    pages,
    profile,
    mastery: (planId) => savedQuizzes(store, "s1", planId).mastery,
  });
  const lessonIds = (saved.versions[0] as CoursePlan).committed.lessons.map((l) => l.id);
  const [first, second] = lessonIds;
  if (!first || !second) throw new Error("the plan has fewer than two lessons");
  const lesson = (await builder.build(first)).lessons[first] as Lesson;
  const examiner = createExaminer({
    orchestrator,
    store,
    sessionId: "s1",
    course: () => courseOf(store, "s1", profile()),
    recorded,
  });
  return { store, orchestrator, pages, saved, builder, examiner, first, second, lesson, lessonIds };
}

function diagramsOf({
  store,
  orchestrator,
  pages,
}: Pick<Awaited<ReturnType<typeof planned>>, "store" | "orchestrator" | "pages">) {
  return createDiagramsBuilder({
    orchestrator,
    store,
    sessionId: "s1",
    pages,
    brief: (lessonId) => {
      const course = writtenCourse(store, "s1", savedProfile(store, "s1") as LearnerProfile);
      return course && lessonDiagramsBrief(course, lessonId);
    },
  });
}

function expectDiagram(
  { store }: { store: Store },
  lessonId: string,
  diagrams: Diagram[],
  title: string,
): Diagram {
  const [diagram, ...more] = diagrams;
  const course = writtenCourse(store, "s1", savedProfile(store, "s1") as LearnerProfile);
  const brief = course && lessonDiagramsBrief(course, lessonId);
  const events = store.readTrace<TraceEvent>("s1").filter((e) => e.agent === "diagrams");

  expect(more).toEqual([]);
  expect(diagram).toMatchObject({
    file: { title, page_url: `https://commons.wikimedia.org/wiki/File:${title}` },
    licence: { spdx: "LicenseRef-PublicDomain", adapt: true },
    author: expect.stringMatching(/\w/),
  });
  expect(glossaryProblems(diagram?.labels ?? [], brief?.glossary ?? [])).toEqual([]);
  expect(events.filter((e) => e.missing_recording).map((e) => e.missing_recording)).toEqual([]);
  expect(new Set(events.filter((e) => e.kind === "model_call").map((e) => e.role))).toEqual(
    new Set(["diagram_labels", "image_text", "image_edit"]),
  );
  expect(
    events.filter((e) => e.kind === "tool_call").map((e) => e.summary_en.split(" ")[0]),
  ).toEqual(expect.arrayContaining(["fetch_page[figures]", "fetch_page[file]", "fetch_image"]));
  for (const e of events) {
    expect(e.summary_ar).toMatch(/\p{Script=Arabic}/u);
    expect(e.summary_en).toMatch(/[A-Za-z]/);
  }
  return diagram as Diagram;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// The images in Muse Image's recorded replies, decoded from the b64 Meta sent.
const recordedEdits = () =>
  readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith("images_edits-"))
    .map((name) => {
      const { body } = JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
      return sha256(Buffer.from(body.data[0].b64_json, "base64"));
    });

const expectRelabelled = (diagram: Diagram) =>
  expect(diagram).toMatchObject({
    method: "muse_image",
    output: { mime: "image/webp" },
    check: { problems: [] },
  });

const overridesTraced = (store: Store) =>
  store
    .readTrace<TraceEvent>("s1")
    .filter((e) => e.agent === "diagrams" && e.kind === "decision" && /override/.test(e.summary_en))
    .map((e) => e.summary_en);

// Omar's plan once he passed lesson 1's quiz on his second try, the way the quiz page leaves it.
async function passedFirst() {
  const course = await quizzed();
  const { examiner, first } = course;
  const quiz = (await examiner.quiz(first)).quizzes[0] as Quiz;
  const missed = quiz.items.filter((i) => i.type === "mcq")[1];
  await examiner.attempt(first, quiz.id, answersTo(quiz, OMAR_FIRST, missed?.id));
  const retry = (await examiner.quiz(first)).quizzes[1] as Quiz;
  await examiner.attempt(first, retry.id, answersTo(retry, OMAR_RETRY));
  return course;
}

const modelsOf = (store: Store, agent: string) =>
  store
    .readTrace<TraceEvent>("s1")
    .filter((e) => e.agent === agent && e.kind === "model_call")
    .map((e) => e.model);

// Omar's interview, then his plan, as the plan page builds it.
async function planned() {
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
    forgetLesson: () => {
      throw new Error("a build accepts no version");
    },
  });
  return { store, orchestrator, pages, saved: await planner.build() };
}

// Omar's first message, spoken (#37). In replay the intake page posts this clip as it is, so its
// recorded transcription is what the demo shows.
describe("intake voice message, replaying the bundled clip", () => {
  it("fills nothing in the interview, and answers the transcript only while it waits for a message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "intake-voice-"));
    dirs.push(dir);
    const store = createFileStore(dir);
    const tracer = createTracer(store, "s1");
    const provider = createProvider({
      models: loadModels(),
      profile: recording ? "record" : "replay",
      apiKey: recording ? loadConfig(process.env).modelApiKey : undefined,
      onTrace: tracer.fromProvider,
      fetch: recording
        ? undefined
        : async () => {
            throw new Error("replay must not touch the network");
          },
    });
    const intake = createIntake({
      orchestrator: { runStep: unused },
      store,
      cache: createFileCache(dir),
      sessionId: "s1",
      learner: LEARNER,
      topic: RECORDED_TOPIC,
    });
    const clip = new Uint8Array(readFileSync(join(process.cwd(), "public", INTAKE_VOICE_CLIP)));
    const post = () =>
      transcribeResponse(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: clip,
        }),
        (audio) => transcribeVoice({ store, sessionId: "s1", provider }, audio),
      );

    const early = await post();
    intake.start();
    const res = await post();

    expect(early.status).toBe(409);
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    for (const word of ["محاسب", "الرياض", "محلل بيانات"]) expect(text).toContain(word);
    expect(intake.view()?.turns).toHaveLength(1);
    const trace = store.readTrace<TraceEvent>("s1");
    expect(trace).toMatchObject([
      {
        agent: "intake",
        kind: "model_call",
        role: "transcribe",
        model: "muse-voice-transcribe-1.0",
      },
    ]);
    // $0.18 an audio hour (config/models.yaml) for the 9.04 s the recording bills.
    expect(trace[0]?.cost_usd).toBeCloseTo((0.18 * 9.04) / 3600, 6);
    expect(`${trace[0]?.summary_ar} ${trace[0]?.summary_en}`).not.toMatch(/محاسب|الرياض/);
  });
});
