import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../../../contracts/index.ts";
import {
  DONT_KNOW,
  diagnosticErrors,
  InvalidAnswers,
  prepareDiagnostic,
  scoreDiagnostic,
} from "./diagnostic.ts";

const question = (n: number) => ({
  prompt_ar: `سؤال ${n}`,
  options_ar: [`صحيح ${n}`, `خطأ ${n}أ`, `خطأ ${n}ب`, `خطأ ${n}ج`],
  answer: `صحيح ${n}`,
});
const DIAGNOSTIC: Diagnostic = { questions: [question(1), question(2), question(3)] };

describe("scoreDiagnostic", () => {
  const questions = prepareDiagnostic(DIAGNOSTIC);

  it("scores a right answer 1 and a wrong or don't-know answer 0, and sets the level", () => {
    const result = scoreDiagnostic(questions, { q1: "صحيح 1", q2: "خطأ 2أ", q3: DONT_KNOW });

    expect(result).toEqual({
      level: "beginner",
      scores: [
        { question_id: "q1", score: 1 },
        { question_id: "q2", score: 0 },
        { question_id: "q3", score: 0 },
      ],
    });
  });

  it("calls two right of three intermediate and three of three advanced", () => {
    const two = { q1: "صحيح 1", q2: "صحيح 2", q3: "خطأ 3ب" };
    const three = { q1: "صحيح 1", q2: "صحيح 2", q3: "صحيح 3" };

    expect(scoreDiagnostic(questions, two).level).toBe("intermediate");
    expect(scoreDiagnostic(questions, three).level).toBe("advanced");
  });

  it("refuses answers that skip a question or pick a text that is not one of its options", () => {
    expect(() => scoreDiagnostic(questions, { q1: "صحيح 1", q2: "صحيح 2" })).toThrow(
      InvalidAnswers,
    );
    expect(() => scoreDiagnostic(questions, { q1: "صحيح 1", q2: "صحيح 2", q3: "شيء آخر" })).toThrow(
      /q3/,
    );
  });
});

describe("prepareDiagnostic", () => {
  it("numbers the questions, keeps every option and adds don't-know last", () => {
    const questions = prepareDiagnostic(DIAGNOSTIC);

    expect(questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    for (const [i, q] of questions.entries()) {
      const original = DIAGNOSTIC.questions[i];
      expect(q.prompt_ar).toBe(original?.prompt_ar);
      expect(q.answer).toBe(original?.answer);
      expect(q.options_ar.at(-1)).toBe(DONT_KNOW);
      expect(q.options_ar.slice(0, -1).toSorted()).toEqual(original?.options_ar.toSorted());
    }
  });

  it("shuffles the options, so the right answer does not always come first", () => {
    const firsts = Array.from(
      { length: 20 },
      () => prepareDiagnostic(DIAGNOSTIC)[0]?.options_ar[0],
    );

    expect(new Set(firsts).size).toBeGreaterThan(1);
  });
});

describe("diagnosticErrors", () => {
  it("accepts three questions with four different options and the answer among them", () => {
    expect(diagnosticErrors(DIAGNOSTIC)).toEqual([]);
  });

  it("names a question whose answer is not an option and one with a repeated option", () => {
    const errors = diagnosticErrors({
      questions: [
        { ...question(1), answer: "غير موجود" },
        { ...question(2), options_ar: ["أ", "أ", "ب", "ج"], answer: "أ" },
        question(3),
      ],
    });

    expect(errors).toEqual([
      expect.stringMatching(/^question 1: .*answer/),
      expect.stringMatching(/^question 2: .*repeat/),
    ]);
  });

  it("names a question that offers «don't know» itself, since the app adds it", () => {
    const errors = diagnosticErrors({
      questions: [
        question(1),
        question(2),
        { ...question(3), options_ar: ["صحيح 3", "خطأ 3أ", "خطأ 3ب", DONT_KNOW] },
      ],
    });

    expect(errors).toEqual([expect.stringMatching(/^question 3: /)]);
  });

  it("wants exactly three questions with four options each", () => {
    expect(diagnosticErrors({ questions: [question(1), question(2)] })).toEqual([
      expect.stringMatching(/3 questions/),
    ]);
    const short = { ...question(3), options_ar: ["صحيح 3", "خطأ"] };
    expect(diagnosticErrors({ questions: [question(1), question(2), short] })).toEqual([
      expect.stringMatching(/^question 3: .*4 options/),
    ]);
  });
});
