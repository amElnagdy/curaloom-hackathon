// The rules every quiz keeps (#20), how an attempt is scored, and the mastery gate: a lesson opens
// once the lesson before it has a passed quiz.

import type { Mastery, Quiz, QuizAttempt } from "../../../../contracts/index.ts";
import { contentHash } from "../../store/store.ts";
import { addressIn } from "../lesson/rules.ts";

type Item = Quiz["items"][number];
type Graded = QuizAttempt["answers"][number];
export type Answer = { item_id: string; response: string };

export const QUIZ_ITEMS = { min: 5, max: 8 };

// Replay only (#55): by attempt id, the learner's own answers to the items whose recorded answers
// were graded in their place.
export type Replaced = Record<string, Answer[]>;

// A lesson's quizzes and attempts, oldest first, and its mastery. The last quiz is the one to take.
export type QuizView = {
  quizzes: Quiz[];
  attempts: QuizAttempt[];
  mastery: Mastery | undefined;
  replaced?: Replaced;
};

// Replay only (#55): whether every attempt with the lesson's best score so far had recorded answers
// graded in place of the learner's, so the pages do not credit that score to them.
export function bestRecorded(attempts: QuizAttempt[], replaced: Replaced | undefined): boolean {
  const best = Math.max(...attempts.map((a) => a.score));
  const top = attempts.filter((a) => a.score === best);
  return top.length > 0 && top.every((a) => replaced?.[a.id] !== undefined);
}

// Whether the lesson needs a quiz written: it has none, or its last one has an attempt below the
// gate and the lesson is not passed.
export function quizDue({ quizzes, attempts, mastery }: QuizView): boolean {
  const last = quizzes.at(-1);
  if (!last) return true;
  return !mastery?.passed && attempts.some((a) => a.quiz_id === last.id && !a.passed);
}

// A quiz as the learner sees it before answering: no answer key, no rubric.
export type KeylessQuiz = Omit<Quiz, "items"> & { items: Omit<Item, "answer" | "rubric_ar">[] };

export const withoutKeys = (quiz: Quiz): KeylessQuiz => ({
  ...quiz,
  items: quiz.items.map(({ answer: _, rubric_ar: __, ...item }) => item),
});

// What is wrong with a quiz, told in English for the model's retry. `terms` are the ids of the
// lesson's glossary entries. A violation names no option or key, since the trace shows it.
export function quizViolations(quiz: Quiz, terms: string[]): string[] {
  const violations: string[] = [];
  const count = quiz.items.length;
  if (count < QUIZ_ITEMS.min || count > QUIZ_ITEMS.max) {
    violations.push(
      `the quiz has ${count} items; a quiz has ${QUIZ_ITEMS.min} to ${QUIZ_ITEMS.max}`,
    );
  }
  if (!quiz.items.some((i) => i.type === "short")) violations.push("the quiz has no short answer");
  if (!quiz.items.some((i) => i.type === "mcq")) {
    violations.push("the quiz has no multiple choice item");
  }
  for (const item of quiz.items) {
    if (item.type === "mcq") {
      const options = item.options_ar.length;
      if (options < 3 || options > 4) {
        violations.push(
          `item ${item.id} has ${options} options; a multiple-choice item has 3 or 4`,
        );
      }
      if (new Set(item.options_ar).size < options)
        violations.push(`item ${item.id} repeats an option`);
      if (!item.options_ar.includes(item.answer)) {
        violations.push(`item ${item.id}'s answer is not one of its options`);
      }
    } else if (item.options_ar.length) {
      violations.push(`item ${item.id} is a short answer but has options`);
    }
    for (const id of item.glossary_ids.filter((id) => !terms.includes(id))) {
      violations.push(`item ${item.id} names glossary term ${id}, which the lesson lacks`);
    }
    if ([item.prompt_ar, ...item.options_ar, item.answer, item.rubric_ar].some(addressIn)) {
      violations.push(`item ${item.id} has a web address or email`);
    }
  }
  return violations;
}

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

// The items that ask again a question of the lesson's earlier quizzes (`asked`), whose keys the
// learner has seen.
export function repeatViolations(quiz: Quiz, asked: string[]): string[] {
  const earlier = new Set(asked.map(tidy));
  return quiz.items
    .filter((item) => earlier.has(tidy(item.prompt_ar)))
    .map((item) => `item ${item.id} repeats an earlier question`);
}

// Where the judge, answering each multiple-choice item from the lesson alone, disagrees with its key.
export function keyViolations(
  quiz: Quiz,
  choices: { item_id: string; choice: string }[],
): string[] {
  return quiz.items
    .filter((item) => item.type === "mcq")
    .flatMap((item) => {
      const choice = choices.find((c) => c.item_id === item.id)?.choice;
      if (choice === undefined) return [`the check did not answer item ${item.id}`];
      if (choice === item.answer) return [];
      return [`item ${item.id}'s key is not the option a reader of the lesson alone chose`];
    });
}

// A multiple-choice answer, graded by code; the rubric says why the key is right.
export function gradeChoice(item: Item, response: string): { score: number; feedback_ar: string } {
  return response === item.answer
    ? { score: 1, feedback_ar: `صحيح. ${item.rubric_ar}` }
    : { score: 0, feedback_ar: `الإجابة الصحيحة «${item.answer}». ${item.rubric_ar}` };
}

// What is wrong with answers to a quiz: an item with no answer, a multiple-choice answer that is not
// one of its options, or an answer to an item the quiz lacks.
export function answerProblems(quiz: Quiz, responses: Answer[]): string[] {
  const problems = quiz.items.flatMap((item) => {
    const response = responses.find((r) => r.item_id === item.id)?.response.trim();
    if (!response) return [`item ${item.id} has no answer`];
    if (item.type === "mcq" && !item.options_ar.includes(response)) {
      return [`item ${item.id}'s answer is not one of its options`];
    }
    return [];
  });
  const unknown = responses.filter((r) => !quiz.items.some((i) => i.id === r.item_id));
  return [...problems, ...unknown.map((r) => `the quiz has no item ${r.item_id}`)];
}

// The attempt the graded answers make: its score is the mean of the items', and it passes at the
// quiz's gate.
export function attemptOf(quiz: Quiz, answers: Graded[], simDay: number): QuizAttempt {
  const score = answers.reduce((sum, a) => sum + a.score, 0) / quiz.items.length;
  return {
    id: `a_${contentHash({ quiz: quiz.id, answers, simDay })}`,
    quiz_id: quiz.id,
    lesson_id: quiz.lesson_id,
    sim_day: simDay,
    answers,
    score,
    passed: score >= quiz.pass_threshold,
  };
}

// The lesson's mastery after one more attempt: the best score and a pass are kept.
export function masteryAfter(mastery: Mastery | undefined, attempt: QuizAttempt): Mastery {
  return {
    lesson_id: attempt.lesson_id,
    best_score: Math.max(mastery?.best_score ?? 0, attempt.score),
    passed: (mastery?.passed ?? false) || attempt.passed,
    attempts: (mastery?.attempts ?? 0) + 1,
  };
}

// Whether a lesson is open: the plan's first lesson always is, and each later one once the lesson
// before it is passed.
export function lessonOpen(lessonIds: string[], mastery: Mastery[], lessonId: string): boolean {
  const at = lessonIds.indexOf(lessonId);
  if (at <= 0) return at === 0;
  const before = lessonIds[at - 1];
  return mastery.some((m) => m.lesson_id === before && m.passed);
}

export const RECAP_ITEMS = 5;
export const RECAP_LESSON = "recap";

// A short quiz over the lessons the learner passed, for a return after a break: at most five
// multiple-choice items, so code grades it, taken in turn from each lesson, the ones the learner
// missed first. An item's id names its quiz.
export function recapQuiz(
  quizzes: Quiz[],
  attempts: QuizAttempt[],
  mastery: Mastery[],
): Quiz | undefined {
  const missed = new Set(
    attempts.flatMap((a) =>
      a.answers.filter((x) => x.score < 1).map((x) => `${a.quiz_id}:${x.item_id}`),
    ),
  );
  const pools = mastery
    .filter((m) => m.passed)
    .map((m) =>
      quizzes
        .filter((q) => q.lesson_id === m.lesson_id)
        .flatMap((q) =>
          q.items
            .filter((item) => item.type === "mcq")
            .map((item) => ({ ...item, id: `${q.id}:${item.id}` })),
        )
        .toSorted((a, b) => Number(missed.has(b.id)) - Number(missed.has(a.id))),
    )
    .filter((pool) => pool.length);
  const [first] = quizzes;
  if (!pools.length || !first) return undefined;
  const items: Item[] = [];
  for (let turn = 0; items.length < RECAP_ITEMS && pools.some((p) => p[turn]); turn++) {
    for (const item of pools.map((p) => p[turn])) {
      if (item && items.length < RECAP_ITEMS) items.push(item);
    }
  }
  return {
    id: `recap_${contentHash(items.map((i) => i.id))}`,
    lesson_id: RECAP_LESSON,
    items,
    pass_threshold: first.pass_threshold,
  };
}

// The recap's attempt, graded by code alone. It is the learner's recall after a break, so it stays
// out of the lessons' attempts and mastery.
export const gradeRecap = (quiz: Quiz, responses: Answer[], simDay: number): QuizAttempt =>
  attemptOf(
    quiz,
    quiz.items.map((item) => {
      const response = responses.find((r) => r.item_id === item.id)?.response.trim() ?? "";
      return { item_id: item.id, response, ...gradeChoice(item, response) };
    }),
    simDay,
  );

// The lesson whose recap items the learner missed most; a tie goes to the later lesson, the one
// nearer what they study next. `quizzes` are the plan's, oldest first, so a lesson's first quiz
// comes after the lessons before it.
export function recapWeakest(attempt: QuizAttempt, quizzes: Quiz[]): string {
  const lessonOf = new Map(quizzes.map((q) => [q.id, q.lesson_id]));
  const order = [...new Set(quizzes.map((q) => q.lesson_id))];
  const misses = new Map<string, number>();
  for (const answer of attempt.answers) {
    const lesson = lessonOf.get(answer.item_id.split(":")[0] ?? "");
    if (lesson && answer.score < 1) misses.set(lesson, (misses.get(lesson) ?? 0) + 1);
  }
  const ranked = [...misses].toSorted(
    ([a, x], [b, y]) => y - x || order.indexOf(b) - order.indexOf(a),
  );
  return ranked[0]?.[0] ?? order.at(-1) ?? "";
}
