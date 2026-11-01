import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Lesson, Quiz } from "../../../../contracts/index.ts";
import { RECORDED_TOPIC } from "../../../../demo/script.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { loadConfig } from "../../../config.ts";
import { createOrchestrator } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type ModelResult, type Provider } from "../../providers/provider.ts";
import { createFileStore } from "../../store/store.ts";
import type { TraceEvent } from "../../trace/trace.ts";
import {
  type Course,
  createExaminer,
  type ExaminerDeps,
  type GradeBrief,
  gradeAnswers,
  type QuizBrief,
  QuizConflict,
} from "./examiner.ts";
import { attemptOf, quizViolations } from "./rules.ts";

// RECORD_FIXTURES is a test-only switch, as in contracts/smoke.test.ts: re-record with
// `pnpm fixtures:record`.
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

const seed = loadOmarSeed(RECORDED_TOPIC);
const LESSON = seed.lessons[0] as Lesson;
const COURSE: Course = {
  plan_id: "plan_seed",
  lesson_ids: ["L1", "L2"],
  lessons: { L1: LESSON, L2: { ...LESSON, id: "L2" } },
  glossary: seed.glossary,
  background: seed.profile.background,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The recorded examiner on a fresh session. `tamper` changes a model reply before the examiner
// reads it.
function examinerFor(tamper?: (schema: string, json: unknown) => unknown) {
  const store = freshStore();
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) => {
      const provider = createProvider({
        models: loadModels(),
        profile: recording ? "record" : "replay",
        apiKey: recording ? loadConfig(process.env).modelApiKey : undefined,
        onTrace,
      });
      if (!tamper) return provider;
      const tampered: Provider = {
        ...provider,
        structured: async (request) => {
          const result = await provider.structured(request);
          return {
            ...result,
            json: tamper(request.schema.name, result.json) as typeof result.json,
          };
        },
      };
      return tampered;
    },
  });
  const examiner = createExaminer({ orchestrator, store, sessionId: "s1", course: () => COURSE });
  const trace = () => store.readTrace<TraceEvent>("s1");
  return { examiner, orchestrator, trace };
}

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "examiner-replay-"));
  dirs.push(dir);
  return createFileStore(dir);
}

describe("the examiner, on the seed's lesson", () => {
  it("writes a quiz that keeps the rules, with keys a reader of the lesson alone agrees with", async () => {
    const { examiner, trace } = examinerFor();

    const view = await examiner.quiz("L1");

    const quiz = view.quizzes[0] as Quiz;
    expect(view.quizzes).toHaveLength(1);
    expect(quizViolations(quiz, LESSON.glossary_ids)).toEqual([]);
    expect(
      trace()
        .filter((e) => e.kind === "model_call")
        .map((e) => e.summary_en),
    ).toEqual([
      expect.stringMatching(/^Writing the quiz/),
      expect.stringMatching(/^Answering the quiz's multiple-choice items .* without the keys/),
    ]);
    // Asked again, it has the quiz.
    expect((await examiner.quiz("L1")).quizzes).toEqual([quiz]);
  }, 300_000);

  it("rejects a quiz whose key the lesson does not support, and writes it again", async () => {
    // The writer's first reply gets a wrong key on its first multiple-choice item.
    let wrong: string | undefined;
    const { examiner, trace } = examinerFor((schema, json) => {
      if (schema !== "QuizDraft" || wrong) return json;
      const draft = json as { items: Quiz["items"] };
      const items = draft.items.map((item) => ({ ...item }));
      const first = items.find((item) => item.type === "mcq");
      wrong = first?.options_ar.find((o) => o !== first.answer);
      if (first && wrong) first.answer = wrong;
      return { ...draft, items };
    });

    const view = await examiner.quiz("L1");

    expect(wrong).toBeDefined();
    expect(
      trace().some(
        (e) =>
          e.kind === "error" &&
          /key is not the option a reader of the lesson alone chose/.test(e.summary_en),
      ),
    ).toBe(true);
    // The trace drawer shows every event, so no key or option is in one.
    for (const event of trace()) expect(event.summary_en).not.toContain(wrong);
    expect(quizViolations(view.quizzes[0] as Quiz, LESSON.glossary_ids)).toEqual([]);
  }, 300_000);

  it("trims the quiz's text, so an option written with spaces around it can be chosen", async () => {
    const plain = (await examinerFor().examiner.quiz("L1")).quizzes[0] as Quiz;
    const spaced = (text: string) => ` ${text}\n`;
    const { examiner } = examinerFor((schema, json) => {
      if (schema !== "QuizDraft") return json;
      const draft = json as { items: Quiz["items"] };
      return {
        items: draft.items.map((item) => ({
          ...item,
          prompt_ar: spaced(item.prompt_ar),
          options_ar: item.options_ar.map(spaced),
          answer: spaced(item.answer),
          rubric_ar: spaced(item.rubric_ar),
        })),
      };
    });

    const quiz = (await examiner.quiz("L1")).quizzes[0] as Quiz;
    const { attempt } = await examiner.attempt(
      "L1",
      quiz.id,
      quiz.items.map((item) => ({ item_id: item.id, response: item.answer })),
    );

    expect(quiz).toEqual(plain);
    const chosen = attempt.answers.filter((a) =>
      quiz.items.some((i) => i.id === a.item_id && i.type === "mcq"),
    );
    expect(chosen.length).toBeGreaterThan(0);
    for (const answer of chosen) expect(answer.score).toBe(1);
  }, 300_000);

  it("keeps a lesson shut until the lesson before it is passed", async () => {
    const { examiner } = examinerFor();

    await expect(examiner.quiz("L2")).rejects.toThrow(QuizConflict);
    await expect(examiner.quiz("L2")).rejects.toThrow(
      "Lesson L2 is locked until lesson L1 is passed",
    );
    await expect(examiner.attempt("L2", "q_L2", [])).rejects.toThrow(
      "Lesson L2 is locked until lesson L1 is passed",
    );
  });
});

// The writer gives each lesson the seed's quiz; the grader gives every answer full marks. The first
// step whose key starts with `held` waits for release().
function stubSteps(held: string) {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => (release = resolve));
  let holding = true;
  const runStep = async (_: string, __: unknown, input: unknown, { key = "" } = {}) => {
    if (holding && key.startsWith(held)) {
      holding = false;
      await waiting;
    }
    if (key.startsWith("quiz:")) {
      const { lesson } = input as QuizBrief;
      return { ...SEED_QUIZ, id: `q_${lesson.id}`, lesson_id: lesson.id };
    }
    const { quiz, responses, sim_day } = input as GradeBrief;
    const marked = responses.map((r) => ({ ...r, score: 1, feedback_ar: "صحيح." }));
    return attemptOf(quiz, marked, sim_day);
  };
  return { orchestrator: { runStep } as unknown as ExaminerDeps["orchestrator"], release };
}

const SEED_QUIZ = seed.quizzes[0] as Quiz;
const keysOf = (quiz: Quiz) =>
  quiz.items.map((item) => ({ item_id: item.id, response: item.answer }));

// The routes let a session write one quiz and grade one attempt at a time, but a quiz and an attempt
// may run together, and so may two servers.
describe("the examiner's saved quizzes", () => {
  it("keeps a quiz written while an attempt was being graded", async () => {
    const { orchestrator, release } = stubSteps("grade:");
    const examiner = createExaminer({
      orchestrator,
      store: freshStore(),
      sessionId: "s1",
      course: () => COURSE,
    });
    const quiz = (await examiner.quiz("L1")).quizzes[0] as Quiz;

    // The same answers twice: the first grading lands last, after the second passed lesson 1 and
    // lesson 2's quiz was written.
    const slow = examiner.attempt("L1", quiz.id, keysOf(quiz));
    await examiner.attempt("L1", quiz.id, keysOf(quiz));
    await examiner.quiz("L2");
    release();
    await slow;

    expect(examiner.view("L1")).toMatchObject({
      attempts: [{ quiz_id: quiz.id, passed: true }],
      mastery: { passed: true, attempts: 1 },
    });
    expect(examiner.view("L2")?.quizzes.map((q) => q.id)).toEqual(["q_L2"]);
  });

  it("keeps an attempt graded while a quiz was being written", async () => {
    const { orchestrator, release } = stubSteps("quiz:");
    const examiner = createExaminer({
      orchestrator,
      store: freshStore(),
      sessionId: "s1",
      course: () => COURSE,
    });

    // Lesson 1's quiz asked for twice: the first writing lands last, after the second's quiz was
    // passed and lesson 2's quiz was written.
    const slow = examiner.quiz("L1");
    const quiz = (await examiner.quiz("L1")).quizzes[0] as Quiz;
    await examiner.attempt("L1", quiz.id, keysOf(quiz));
    await examiner.quiz("L2");
    release();
    await slow;

    expect(examiner.view("L1")).toMatchObject({
      quizzes: [{ id: quiz.id }],
      attempts: [{ quiz_id: quiz.id, passed: true }],
      mastery: { passed: true, attempts: 1 },
    });
    expect(examiner.view("L2")?.quizzes.map((q) => q.id)).toEqual(["q_L2"]);
  });
});

// Omar's answers, in Gulf dialect, to five short questions on the lesson, each with the score its
// rubric gives.
const SHORT: [Quiz["items"][number], string, number][] = [
  [
    {
      id: "i1",
      type: "short",
      prompt_ar: "اذكر مثالًا من عملك تلخصه بجدول محوري، وما الذي تجمع البيانات حسبه.",
      options_ar: [],
      answer: "أجمع المصروفات حسب القسم وأحسب إجمالي كل قسم في كل شهر.",
      rubric_ar:
        "درجة كاملة لأي جدول تفصيلي يُجمع حسب فئة (قسم، شهر، مورد) مع إجمالي أو متوسط. نصف درجة لمثال بلا فئة واضحة.",
      glossary_ids: [],
    },
    "أجمع فواتير الموردين حسب المورد وأطلع إجمالي كل واحد بالشهر.",
    1,
  ],
  [
    {
      id: "i2",
      type: "short",
      prompt_ar: "بكلماتك: لماذا يفيد برنامج جداول البيانات المحاسب أكثر من الآلة الحاسبة؟",
      options_ar: [],
      answer: "لأنه يحفظ البيانات منظمة في صفوف وأعمدة ويعيد الحساب تلقائيًا حين تتغير قيمة.",
      rubric_ar:
        "درجة كاملة لإجابة تذكر أمرين: أن البرنامج يحفظ البيانات منظمة في صفوف وأعمدة، وأنه يعيد الحساب تلقائيًا حين تتغير قيمة. نصف درجة لمن يذكر أحدهما.",
      glossary_ids: [],
    },
    "عشان البرنامج يحسب لحاله، لو غيرت رقم يتعدل المجموع على طول.",
    0.5,
  ],
  [
    {
      id: "i3",
      type: "short",
      prompt_ar: "ما الفرق بين تصفية الصفوف وحذفها؟",
      options_ar: [],
      answer: "التصفية تخفي الصفوف التي لا تحقق الشرط مؤقتًا، وتعود كلها حين تُلغى التصفية.",
      rubric_ar:
        "درجة كاملة لمن يذكر أن التصفية تخفي الصفوف مؤقتًا ولا تحذفها، فتعود حين تُلغى. لا درجة لمن يقول إنها تحذفها.",
      glossary_ids: [],
    },
    "الفلتر يخبي الصفوف اللي ما أبيها بس هي موجودة، أشيل الفلتر وترجع كلها.",
    1,
  ],
  [
    {
      id: "i4",
      type: "short",
      prompt_ar: "ما الخلية في ورقة العمل؟",
      options_ar: [],
      answer: "مربع يتقاطع فيه صف وعمود، ويحمل قيمة أو معادلة.",
      rubric_ar:
        "درجة كاملة لمن يذكر أنها تقاطع صف وعمود وأنها تحمل قيمة أو معادلة. نصف درجة لمن يذكر أحدهما. لا درجة لما سوى ذلك.",
      glossary_ids: [],
    },
    "هي الصف كله من أوله لآخره.",
    0,
  ],
  [
    {
      id: "i5",
      type: "short",
      prompt_ar: "متى تستخدم الجدول المحوري بدل التصفية؟",
      options_ar: [],
      answer: "حين أريد إجماليات حسب فئة، لا مجرد عرض صفوف معينة.",
      rubric_ar:
        "درجة كاملة لمن يذكر أن الجدول المحوري للإجماليات أو التلخيص حسب فئة، وأن التصفية لعرض صفوف معينة فقط. نصف درجة لمن يذكر أحدهما. لا درجة لمن لا يجيب.",
      glossary_ids: [],
    },
    "والله ما أدري صراحة.",
    0,
  ],
];

describe("grading", () => {
  it("grades short answers in Gulf dialect by their rubrics, at least four of five right", async () => {
    const { orchestrator } = examinerFor();
    const quiz: Quiz = {
      id: "q_dialect",
      lesson_id: "L1",
      items: SHORT.map(([item]) => item),
      pass_threshold: 0.8,
    };

    const attempt = await gradeAnswers(orchestrator, "s1", {
      quiz,
      responses: SHORT.map(([item, response]) => ({ item_id: item.id, response })),
      sim_day: 2,
    });

    const right = SHORT.filter(
      ([item, , score]) => attempt.answers.find((a) => a.item_id === item.id)?.score === score,
    );
    expect(right.length).toBeGreaterThanOrEqual(4);
    for (const answer of attempt.answers) expect(answer.feedback_ar).toMatch(/\p{Script=Arabic}/u);
  }, 300_000);
});

// A six-item quiz, four multiple choice then two short answers, written and checked by a fake model
// whose judge gives every short answer full credit. `graded` holds what the judge was sent.
const DRAFT = {
  items: [
    ...[1, 2, 3, 4].map((n) => ({
      type: "mcq" as const,
      prompt_ar: `سؤال اختيار ${n}`,
      options_ar: [`صحيح ${n}`, `خطأ ${n}أ`, `خطأ ${n}ب`, `خطأ ${n}ج`],
      answer: `صحيح ${n}`,
      rubric_ar: "لأن الدرس يقوله.",
      glossary_ids: [],
    })),
    ...[5, 6].map((n) => ({
      type: "short" as const,
      prompt_ar: `سؤال قصير ${n}`,
      options_ar: [],
      answer: `إجابة نموذجية ${n}`,
      rubric_ar: "درجة كاملة لمن يذكر الفكرة.",
      glossary_ids: [],
    })),
  ],
};

function judged(recorded?: ExaminerDeps["recorded"]) {
  const store = freshStore();
  const graded: string[] = [];
  const reply = (schema: string, input: unknown) => {
    if (schema === "QuizDraft") return DRAFT;
    if (schema === "KeyCheck") {
      return { choices: [1, 2, 3, 4].map((n) => ({ item_id: `i${n}`, choice: `صحيح ${n}` })) };
    }
    graded.push(String(input));
    return {
      grades: ["i5", "i6"].map((item_id) => ({ item_id, score: 1, feedback_ar: "أحسنت." })),
    };
  };
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) => ({
      ...createProvider({ models: loadModels(), profile: "replay", onTrace }),
      structured: async (call) =>
        ({
          text: "",
          json: reply(call.schema.name, call.input),
          tool_calls: [],
          citations: [],
          image: null,
          usage: { in: 0, out: 0, cost_usd: 0 },
          latency_ms: 1,
          model: "fake",
        }) as unknown as ModelResult<never>,
    }),
  });
  const examiner = createExaminer({
    orchestrator,
    store,
    sessionId: "s1",
    course: () => COURSE,
    recorded,
  });
  const decisions = () =>
    store
      .readTrace<TraceEvent>("s1")
      .filter((e) => e.kind === "decision" && e.summary_en.startsWith("Replay:"))
      .map((e) => e.summary_en);
  return { examiner, graded, decisions };
}

const RECORDED = ["إجابة مسجّلة أولى", "إجابة مسجّلة ثانية"];
const MINE = ["إجابتي الأولى", "إجابتي الثانية"];
// Recorded short answers to lesson 1's first quiz and its retry, as demo/script.ts has them.
const withRetry = (lessonId: string, n: number) =>
  lessonId === "L1" && n < 2 ? RECORDED : undefined;
// Recorded short answers to lesson 1's first quiz only, so no quiz after it is recorded.
const firstOnly = (lessonId: string, n: number) =>
  lessonId === "L1" && n === 0 ? RECORDED : undefined;

// The learner's answers: their own short answers, and the first `wrong` multiple-choice items missed.
function mine(quiz: Quiz, wrong = 0) {
  const shorts = [...MINE];
  let left = wrong;
  return quiz.items.map((item) => ({
    item_id: item.id,
    response:
      item.type === "short"
        ? (shorts.shift() as string)
        : left-- > 0
          ? (item.options_ar.find((o) => o !== item.answer) as string)
          : item.answer,
  }));
}

describe("grading in replay, which answers only the recorded short answers (#55)", () => {
  it("sends the judge the recorded short answers in place of the learner's, and keeps theirs aside", async () => {
    const { examiner, graded, decisions } = judged(withRetry);
    const quiz = (await examiner.quiz("L1")).quizzes[0] as Quiz;

    const view = await examiner.attempt("L1", quiz.id, mine(quiz));

    expect(graded).toHaveLength(1);
    for (const text of RECORDED) expect(graded[0]).toContain(JSON.stringify(text));
    for (const text of MINE) expect(graded[0]).not.toContain(text);
    expect(view.attempt.answers.slice(4).map((a) => a.response)).toEqual(RECORDED);
    expect(view.replaced).toEqual({
      [view.attempt.id]: [
        { item_id: "i5", response: MINE[0] },
        { item_id: "i6", response: MINE[1] },
      ],
    });
    expect(decisions()).toEqual([
      "Replay: grading the recorded short answers in place of 2 of the learner's, which have no recording",
    ]);
    // The same answers again answer the same attempt.
    expect((await examiner.attempt("L1", quiz.id, mine(quiz))).attempt).toEqual(view.attempt);
  });

  it("sends the learner's own short answers outside replay", async () => {
    const { examiner, graded } = judged();
    const quiz = (await examiner.quiz("L1")).quizzes[0] as Quiz;

    const view = await examiner.attempt("L1", quiz.id, mine(quiz));

    for (const text of MINE) expect(graded[0]).toContain(JSON.stringify(text));
    expect(view.replaced).toBeUndefined();
  });

  it("grades wrong choices as their keys below the gate on the last recorded quiz", async () => {
    const { examiner, decisions } = judged(firstOnly);
    const quiz = (await examiner.quiz("L1")).quizzes[0] as Quiz;

    const view = await examiner.attempt("L1", quiz.id, mine(quiz, 2));

    expect(view.attempt).toMatchObject({ score: 1, passed: true });
    expect(view.attempt.answers.slice(0, 2).map((a) => a.response)).toEqual(["صحيح 1", "صحيح 2"]);
    expect(view.replaced?.[view.attempt.id]?.map((a) => a.item_id)).toEqual([
      "i1",
      "i2",
      "i5",
      "i6",
    ]);
    expect(decisions()).toContain(
      "Replay: no quiz after this one is recorded, so 2 wrong multiple-choice answers were graded as their keys",
    );
  });

  it("leaves wrong choices wrong when the attempt passes anyway, or a recorded retry follows", async () => {
    const last = judged(firstOnly);
    const lastQuiz = (await last.examiner.quiz("L1")).quizzes[0] as Quiz;
    const retried = judged(withRetry);
    const firstQuiz = (await retried.examiner.quiz("L1")).quizzes[0] as Quiz;

    const passing = await last.examiner.attempt("L1", lastQuiz.id, mine(lastQuiz, 1));
    const below = await retried.examiner.attempt("L1", firstQuiz.id, mine(firstQuiz, 2));

    expect(passing.attempt.passed).toBe(true);
    expect(passing.attempt.answers[0]).toMatchObject({ item_id: "i1", score: 0 });
    expect(below.attempt.passed).toBe(false);
    expect(below.attempt.answers.slice(0, 2).map((a) => a.score)).toEqual([0, 0]);
  });
});
