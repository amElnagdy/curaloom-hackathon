import { describe, expect, it } from "vitest";
import type { Quiz } from "../../../../contracts/index.ts";
import {
  answerProblems,
  attemptOf,
  gradeChoice,
  gradeRecap,
  keyViolations,
  lessonOpen,
  masteryAfter,
  quizDue,
  quizViolations,
  recapQuiz,
  recapWeakest,
  repeatViolations,
} from "./rules.ts";

type Item = Quiz["items"][number];

const mcq = (id: string, answer = "الجدول المحوري"): Item => ({
  id,
  type: "mcq",
  prompt_ar: "أي أداة تجمع الصفوف حسب القسم وتحسب الإجمالي؟",
  options_ar: ["الجدول المحوري", "التصفية", "دمج الخلايا", "تغيير عرض الأعمدة"],
  answer,
  rubric_ar: "الجدول المحوري يجمع الصفوف حسب فئة ويحسب الإجمالي.",
  glossary_ids: ["g_tcd"],
});

const QUIZ: Quiz = {
  id: "q_L1",
  lesson_id: "L1",
  items: ["i1", "i2", "i3", "i4", "i5"].map((id) => mcq(id)),
  pass_threshold: 0.8,
};

const graded = (scores: number[]) =>
  scores.map((score, i) => ({
    item_id: `i${i + 1}`,
    response: "الجدول المحوري",
    score,
    feedback_ar: "صحيح.",
  }));

describe("attemptOf", () => {
  it("scores an attempt as the mean of its items and passes it at the quiz's gate", () => {
    const attempt = attemptOf(QUIZ, graded([1, 1, 1, 1, 0]), 3);

    expect(attempt).toMatchObject({ quiz_id: "q_L1", lesson_id: "L1", sim_day: 3 });
    expect(attempt.score).toBeCloseTo(0.8);
    expect(attempt.passed).toBe(true);
  });

  it("counts half credit and fails an attempt below the gate", () => {
    const attempt = attemptOf(QUIZ, graded([1, 1, 1, 0.5, 0.5]), 3);

    expect(attempt.score).toBeCloseTo(0.8);
    expect(attemptOf(QUIZ, graded([1, 1, 1, 0.5, 0]), 3)).toMatchObject({ passed: false });
  });
});

describe("the mastery gate", () => {
  const LESSONS = ["L1", "L2", "L3"];
  // A one-item quiz, so its score is the item's.
  const scored = (score: number) => attemptOf({ ...QUIZ, items: [mcq("i1")] }, graded([score]), 3);

  it.each([
    [0.79, false],
    [0.8, true],
  ])("opens the next lesson after a score of %d: %s", (score, open) => {
    const mastery = masteryAfter(undefined, scored(score));

    expect(lessonOpen(LESSONS, [mastery], "L2")).toBe(open);
  });

  it("opens the first lesson before any quiz, and no lesson after one not passed", () => {
    expect(lessonOpen(LESSONS, [], "L1")).toBe(true);
    expect(lessonOpen(LESSONS, [], "L2")).toBe(false);
  });

  it("keeps the best score and a pass through a later, lower attempt", () => {
    const second = masteryAfter(masteryAfter(undefined, scored(0.9)), scored(0.5));

    expect(second).toEqual({ lesson_id: "L1", best_score: 0.9, passed: true, attempts: 2 });
  });
});

const short = (id: string): Item => ({
  id,
  type: "short",
  prompt_ar: "اذكر مثالًا من عملك تلخصه بجدول محوري.",
  options_ar: [],
  answer: "أجمع فواتير الموردين حسب المورد مع إجمالي كل شهر.",
  rubric_ar: "درجة كاملة لأي جدول يُجمع حسب فئة مع إجمالي. نصف درجة لمثال بلا فئة واضحة.",
  glossary_ids: ["g_tcd"],
});

const LESSON_TERMS = ["g_tcd", "g_filter"];
const GOOD: Quiz = { ...QUIZ, items: [mcq("i1"), mcq("i2"), mcq("i3"), mcq("i4"), short("i5")] };
const withItem = (index: number, change: Partial<Item>): Quiz => ({
  ...GOOD,
  items: GOOD.items.map((item, i) => (i === index ? { ...item, ...change } : item)),
});

describe("quizDue", () => {
  const RETRY: Quiz = { ...QUIZ, id: "q_L1_retry" };
  const below = attemptOf(QUIZ, graded([1, 1, 1, 0.5, 0]), 1);
  const passed = attemptOf(RETRY, graded([1, 1, 1, 1, 0.5]), 2);

  it("asks for a quiz before the lesson has one, and for another after an attempt below the gate", () => {
    expect(quizDue({ quizzes: [], attempts: [], mastery: undefined })).toBe(true);
    expect(
      quizDue({ quizzes: [QUIZ], attempts: [below], mastery: masteryAfter(undefined, below) }),
    ).toBe(true);
  });

  it("asks for none while the last quiz waits for its attempt, or once the lesson is passed", () => {
    const afterBelow = masteryAfter(undefined, below);
    expect(quizDue({ quizzes: [QUIZ], attempts: [], mastery: undefined })).toBe(false);
    expect(quizDue({ quizzes: [QUIZ, RETRY], attempts: [below], mastery: afterBelow })).toBe(false);
    expect(
      quizDue({
        quizzes: [QUIZ, RETRY],
        attempts: [below, passed],
        mastery: masteryAfter(afterBelow, passed),
      }),
    ).toBe(false);
  });
});

describe("quizViolations", () => {
  it("finds nothing wrong with a quiz that keeps every rule", () => {
    expect(quizViolations(GOOD, LESSON_TERMS)).toEqual([]);
  });

  it.each([
    ["fewer than five items", { ...GOOD, items: GOOD.items.slice(0, 4) }, /4 items.*5 to 8/],
    [
      "more than eight items",
      {
        ...GOOD,
        items: [...GOOD.items, ...GOOD.items].map((item, i) => ({ ...item, id: `i${i}` })),
      },
      /10 items.*5 to 8/,
    ],
    [
      "no short answer",
      { ...GOOD, items: GOOD.items.map((_, i) => mcq(`i${i + 1}`)) },
      /no short answer/,
    ],
    [
      "no multiple choice",
      { ...GOOD, items: GOOD.items.map((_, i) => short(`i${i + 1}`)) },
      /no multiple choice/,
    ],
    [
      "an answer that is not one of the options",
      withItem(0, { answer: "الفرز" }),
      /^item i1's answer is not one of its options$/,
    ],
    [
      "fewer than three options",
      withItem(1, { options_ar: ["الجدول المحوري", "التصفية"] }),
      /item i2 has 2 options; a multiple-choice item has 3 or 4/,
    ],
    [
      "an option written twice",
      withItem(2, { options_ar: ["الجدول المحوري", "التصفية", "التصفية"] }),
      /item i3 repeats an option/,
    ],
    [
      "a short answer with options",
      withItem(4, { options_ar: ["نعم", "لا"] }),
      /item i5 is a short answer but has options/,
    ],
    [
      "a term the lesson lacks",
      withItem(3, { glossary_ids: ["g_vlookup"] }),
      /item i4 names glossary term g_vlookup, which the lesson lacks/,
    ],
    [
      "a web address in a rubric",
      withItem(2, { rubric_ar: "مفتاح الإجابة الرسمي على quiz-help.example.top" }),
      /^item i3 has a web address or email$/,
    ],
    [
      "an email in an option",
      withItem(1, {
        options_ar: ["الجدول المحوري", "التصفية", "راسل help@example.com", "دمج الخلايا"],
      }),
      /^item i2 has a web address or email$/,
    ],
  ])("catches %s", (_, quiz, violation) => {
    expect(quizViolations(quiz, LESSON_TERMS)).toContainEqual(expect.stringMatching(violation));
  });
});

// The judge answers each multiple-choice item from the lesson alone, without its key.
describe("keyViolations", () => {
  it("accepts keys a reader of the lesson agrees with", () => {
    const choices = GOOD.items
      .slice(0, 4)
      .map((item) => ({ item_id: item.id, choice: item.answer }));

    expect(keyViolations(GOOD, choices)).toEqual([]);
  });

  it("rejects a key a reader of the lesson does not agree with, and an item it did not answer", () => {
    const quiz = withItem(0, { answer: "التصفية" });
    const choices = [
      { item_id: "i1", choice: "الجدول المحوري" },
      { item_id: "i2", choice: "الجدول المحوري" },
      { item_id: "i3", choice: "الجدول المحوري" },
    ];

    expect(keyViolations(quiz, choices)).toEqual([
      "item i1's key is not the option a reader of the lesson alone chose",
      "the check did not answer item i4",
    ]);
  });
});

// A quiz after an attempt below the gate asks other questions than the lesson's earlier quizzes.
describe("repeatViolations", () => {
  it("catches an item that asks an earlier question again, spaces aside", () => {
    const asked = ["  أي أداة تجمع الصفوف   حسب القسم وتحسب الإجمالي؟"];

    expect(repeatViolations(withItem(0, { prompt_ar: "ما فائدة التصفية؟" }), asked)).toEqual([
      "item i2 repeats an earlier question",
      "item i3 repeats an earlier question",
      "item i4 repeats an earlier question",
    ]);
    expect(repeatViolations(GOOD, ["ما فائدة التصفية؟"])).toEqual([]);
  });
});

describe("gradeChoice", () => {
  it("gives a right choice full credit and a wrong one none, with the right answer and why", () => {
    expect(gradeChoice(mcq("i1"), "الجدول المحوري")).toEqual({
      score: 1,
      feedback_ar: "صحيح. الجدول المحوري يجمع الصفوف حسب فئة ويحسب الإجمالي.",
    });
    expect(gradeChoice(mcq("i1"), "التصفية")).toEqual({
      score: 0,
      feedback_ar:
        "الإجابة الصحيحة «الجدول المحوري». الجدول المحوري يجمع الصفوف حسب فئة ويحسب الإجمالي.",
    });
  });
});

// For a learner back after a break (#27): a few items from the lessons they passed.
describe("recapQuiz", () => {
  const quizOf = (lessonId: string): Quiz => ({
    ...GOOD,
    id: `q_${lessonId}`,
    lesson_id: lessonId,
  });
  const QUIZZES = ["L1", "L2", "L3"].map(quizOf);
  const passedOn = (quiz: Quiz, missed: string[]) =>
    attemptOf(
      quiz,
      quiz.items.map((item) => ({
        item_id: item.id,
        response: "",
        score: missed.includes(item.id) ? 0 : 1,
        feedback_ar: "",
      })),
      2,
    );

  it("takes at most five items in turn from each lesson passed, the ones missed first", () => {
    const attempts = [passedOn(QUIZZES[0] as Quiz, ["i4"]), passedOn(QUIZZES[1] as Quiz, ["i2"])];
    const mastery = attempts.map((a) => masteryAfter(undefined, a));

    const recap = recapQuiz(QUIZZES, attempts, mastery);

    expect(recap?.items.map((i) => i.id)).toEqual([
      "q_L1:i4",
      "q_L2:i2",
      "q_L1:i1",
      "q_L2:i1",
      "q_L1:i2",
    ]);
    expect(recap?.lesson_id).toBe("recap");
  });

  it("takes multiple-choice items only, so code grades it, even a short answer the learner missed", () => {
    const attempts = [passedOn(QUIZZES[0] as Quiz, ["i5"])];

    const recap = recapQuiz(
      QUIZZES,
      attempts,
      attempts.map((a) => masteryAfter(undefined, a)),
    );

    expect(recap?.items.map((i) => [i.id, i.type])).toEqual([
      ["q_L1:i1", "mcq"],
      ["q_L1:i2", "mcq"],
      ["q_L1:i3", "mcq"],
      ["q_L1:i4", "mcq"],
    ]);
  });

  it("has nothing before the learner passes a lesson", () => {
    const attempts = [passedOn(QUIZZES[0] as Quiz, ["i1", "i2", "i3"])];

    expect(
      recapQuiz(
        QUIZZES,
        attempts,
        attempts.map((a) => masteryAfter(undefined, a)),
      ),
    ).toBeUndefined();
  });
});

// A recap of five items over L1 and L2, as recapQuiz names them.
const RECAP: Quiz = {
  id: "recap_x",
  lesson_id: "recap",
  items: ["q_L1:i1", "q_L2:i1", "q_L1:i2", "q_L2:i2", "q_L1:i3"].map((id) => mcq(id)),
  pass_threshold: 0.8,
};
const responses = (wrong: string[]) =>
  RECAP.items.map((item) => ({
    item_id: item.id,
    response: wrong.includes(item.id) ? "التصفية" : item.answer,
  }));

describe("gradeRecap", () => {
  it("grades 3 of 5 right as 60%, below the gate, each answer with the right one", () => {
    const attempt = gradeRecap(RECAP, responses(["q_L2:i1", "q_L1:i3"]), 10);

    expect(attempt).toMatchObject({ quiz_id: "recap_x", lesson_id: "recap", sim_day: 10 });
    expect(attempt.score).toBeCloseTo(0.6);
    expect(attempt.passed).toBe(false);
    expect(attempt.answers.map((a) => a.score)).toEqual([1, 0, 1, 1, 0]);
    expect(attempt.answers[1]?.feedback_ar).toMatch(/^الإجابة الصحيحة «الجدول المحوري»/);
  });

  it("passes 4 of 5 at the gate", () => {
    expect(gradeRecap(RECAP, responses(["q_L1:i3"]), 10).passed).toBe(true);
  });
});

describe("answerProblems", () => {
  it("finds nothing wrong with an answer to every item from its options", () => {
    expect(answerProblems(RECAP, responses([]))).toEqual([]);
  });

  it("flags a blank answer, an answer that is not an option and an item the quiz lacks", () => {
    const answers = [
      ...responses([]).slice(2),
      { item_id: "q_L1:i1", response: "  " },
      { item_id: "q_L2:i1", response: "الفرز" },
      { item_id: "q_L9:i9", response: "التصفية" },
    ];

    expect(answerProblems(RECAP, answers)).toEqual([
      "item q_L1:i1 has no answer",
      "item q_L2:i1's answer is not one of its options",
      "the quiz has no item q_L9:i9",
    ]);
  });
});

describe("recapWeakest", () => {
  const QUIZZES = ["L1", "L2"].map((lesson) => ({ ...QUIZ, id: `q_${lesson}`, lesson_id: lesson }));

  it("is the lesson the learner missed most", () => {
    const attempt = gradeRecap(RECAP, responses(["q_L1:i1", "q_L1:i3", "q_L2:i2"]), 10);

    expect(recapWeakest(attempt, QUIZZES)).toBe("L1");
  });

  it("goes to the later lesson on a tie", () => {
    const attempt = gradeRecap(RECAP, responses(["q_L1:i2", "q_L2:i2"]), 10);

    expect(recapWeakest(attempt, QUIZZES)).toBe("L2");
  });
});
