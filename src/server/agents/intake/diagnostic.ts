// The intake's quick check (#16): three multiple-choice questions on the topic that set the
// learner's starting level. The model writes them; code checks each has one right answer, shuffles
// the options (the model tends to put the answer first, spike #8), adds «لا أعرف بعد» so a learner
// need not guess, and scores the answers.

import type { Diagnostic, LearnerProfile } from "../../../../contracts/index.ts";

export const QUESTION_COUNT = 3;
const OPTION_COUNT = 4;
export const DONT_KNOW = "لا أعرف بعد";

export type DiagnosticQuestion = {
  id: string;
  prompt_ar: string;
  options_ar: string[];
  answer: string;
};

type Level = LearnerProfile["diagnostic"]["level"];

// Below half right is a beginner, below 85% intermediate: with three questions, 0–1, 2 and 3.
const LEVELS: [Level, number][] = [
  ["beginner", 0.5],
  ["intermediate", 0.85],
];

// Answers the learner sent that do not fit the questions: a client error.
export class InvalidAnswers extends Error {}

// One line per problem, empty when the model's questions are usable.
export function diagnosticErrors({ questions }: Diagnostic): string[] {
  if (questions.length !== QUESTION_COUNT) {
    return [`expected ${QUESTION_COUNT} questions, got ${questions.length}`];
  }
  return questions.flatMap((q, i) => {
    const problems: string[] = [];
    if (q.options_ar.length !== OPTION_COUNT) {
      problems.push(`has ${q.options_ar.length} options, not ${OPTION_COUNT} options`);
    }
    if (new Set(q.options_ar.map((o) => o.trim())).size !== q.options_ar.length) {
      problems.push("repeats an option");
    }
    if (!q.options_ar.includes(q.answer)) problems.push("its answer is not one of its options");
    // The app adds «لا أعرف بعد» last; a second copy would score as a wrong answer.
    if (q.options_ar.some((o) => o.trim() === DONT_KNOW))
      problems.push(`has ${DONT_KNOW} as an option`);
    return problems.map((p) => `question ${i + 1}: ${p}`);
  });
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// For questions diagnosticErrors() accepted.
export function prepareDiagnostic({ questions }: Diagnostic): DiagnosticQuestion[] {
  return questions.map((q, i) => ({
    id: `q${i + 1}`,
    prompt_ar: q.prompt_ar,
    options_ar: [...shuffled(q.options_ar), DONT_KNOW],
    answer: q.answer,
  }));
}

export function scoreDiagnostic(
  questions: DiagnosticQuestion[],
  answers: Record<string, string>,
): LearnerProfile["diagnostic"] {
  const scores = questions.map((q) => {
    const picked = answers[q.id];
    if (picked === undefined || !q.options_ar.includes(picked)) {
      throw new InvalidAnswers(`${q.id} needs one of its options as the answer`);
    }
    return { question_id: q.id, score: picked === q.answer ? 1 : 0 };
  });
  const share = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const level = LEVELS.find(([, below]) => share < below)?.[0] ?? "advanced";
  return { level, scores };
}
