import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CoursePlan,
  contractErrors,
  type Diagnostic,
  type IntakeReply,
  LearnerProfile,
  type Lesson,
  type Quiz,
} from "../../../../contracts/index.ts";
import { loadConfig } from "../../../config.ts";
import { createOrchestrator, StepFailed } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type ModelResult, type Provider } from "../../providers/provider.ts";
import { createFileCache, createFileStore, type Store } from "../../store/store.ts";
import { createPageFetcher } from "../../tools/fetch-page.ts";
import { createTracer, type TraceEvent } from "../../trace/trace.ts";
import { createPlanner } from "../architect/architect.ts";
import { planViolations } from "../architect/rules.ts";
import { courseOf, createExaminer, QuizConflict } from "../examiner/examiner.ts";
import { lessonOpen, quizViolations } from "../examiner/rules.ts";
import { createLessonBuilder } from "../lesson/lesson.ts";
import { wordCount } from "../lesson/rules.ts";
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

  // The plan page starts the first lesson once the plan is ready; later lessons share its glossary.
  it("writes his first two lessons from the plan, one glossary for both", async () => {
    const { store, orchestrator, pages, saved } = await planned();
    const builder = createLessonBuilder({
      orchestrator,
      store,
      sessionId: "s1",
      pages,
      profile: () => savedProfile(store, "s1") as LearnerProfile,
    });
    const plan = saved.versions[0] as CoursePlan;
    const [first, second] = plan.committed.lessons.map((l) => l.id);
    if (!first || !second) throw new Error("the plan has fewer than two lessons");

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

  // The lesson page asks for the quiz while Omar reads lesson 1.
  it("writes the quiz for his first lesson", async () => {
    const { store, examiner, first, lesson } = await quizzed();

    const quiz = (await examiner.quiz(first)).quizzes[0] as Quiz;

    expect(quizViolations(quiz, lesson.glossary_ids)).toEqual([]);
    expect(new Set(modelsOf(store, "examiner"))).toEqual(new Set(["muse-spark-1.3"]));
  }, 600_000);

  it("keeps his second lesson shut below 80%, then opens it once he passes a quiz with other questions", async () => {
    const { examiner, first, second, lesson, lessonIds } = await quizzed();
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
    expect(quizViolations(retry, lesson.glossary_ids)).toEqual([]);
    const asked = new Set(quiz.items.map((i) => i.prompt_ar));
    expect(retry.items.filter((i) => asked.has(i.prompt_ar))).toEqual([]);

    const passed = await examiner.attempt(first, retry.id, answersTo(retry, OMAR_RETRY));

    expect(passed.attempt.passed).toBe(true);
    expect(passed.mastery).toMatchObject({ passed: true, attempts: 2 });
    expect(lessonOpen(lessonIds, passed.mastery ? [passed.mastery] : [], second)).toBe(true);
    for (const answer of passed.attempt.answers) {
      expect(answer.feedback_ar).toMatch(/\p{Script=Arabic}/u);
    }
  }, 600_000);
});

// Omar's short answers, in Gulf dialect, to the first quiz's short items in order: the first earns
// full credit by its rubric, the second only half (it filters but never summarises by branch).
const OMAR_FIRST = [
  "أسوي ورقة لكل شهر في نفس المصنف، وأحط أعمدة التاريخ والبيان والمدين والدائن والرصيد. خانة الرصيد أكتب فيها معادلة تاخذ الرصيد اللي فوقها وتزيد المدين وتنقص الدائن، فلو غيرت أي مبلغ يتعدل الرصيد بروحه.",
  "أفلتر على كل فرع بروحه وأشوف مبيعاته شهر شهر، وبعدين أرسل الجدول للمدير.",
];

// His short answers to the retry's short items, each earning full credit by its rubric.
const OMAR_RETRY = [
  "أسوي مصنف واحد للسنة فيه ثلاث أوراق: ورقة العملاء فيها التاريخ والعميل والمبلغ والمحصل، وورقة الموردين بنفس الأعمدة تقريبا، وورقة الملخص الشهري. خلايا الملخص ما أكتبها بيدي، أحط فيها معادلات تجمع من ورقة العملاء وورقة الموردين، فأي تعديل هناك يتحدث هنا على طول. وبعدين أسوي رسم بياني من الملخص وأعرضه على الإدارة.",
  "أقول له لا تخاف، الفلتر ما يمسح شي، بس يخبي الصفوف اللي ما تبيها مؤقتا، ولو شلت الفلتر ترجع كلها. مثلا في جدول مدفوعات الموردين أفلتر على مورد واحد وأراجع دفعاته. والجدول المحوري بدل ما أجمع بيدي يطلع لي إجمالي المدفوع لكل مورد في كل شهر في جدول صغير، وهذا اللي تبيه الإدارة.",
];

// His answers to a quiz: each multiple-choice key, except a wrong option on `miss`, and the given
// short answers in order.
function answersTo(quiz: Quiz, shorts: string[], miss?: string) {
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

// Omar's plan with his first lesson written, and the examiner the lesson page asks.
async function quizzed() {
  const { store, orchestrator, pages, saved } = await planned();
  const profile = () => savedProfile(store, "s1") as LearnerProfile;
  const builder = createLessonBuilder({ orchestrator, store, sessionId: "s1", pages, profile });
  const lessonIds = (saved.versions[0] as CoursePlan).committed.lessons.map((l) => l.id);
  const [first, second] = lessonIds;
  if (!first || !second) throw new Error("the plan has fewer than two lessons");
  const lesson = (await builder.build(first)).lessons[first] as Lesson;
  const examiner = createExaminer({
    orchestrator,
    store,
    sessionId: "s1",
    course: () => courseOf(store, "s1", profile()),
  });
  return { store, examiner, first, second, lesson, lessonIds };
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
  });
  return { store, orchestrator, pages, saved: await planner.build() };
}
