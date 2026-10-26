import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, parseItems, parseVerdict, summarize } from "./eval";

const item = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "term-03",
    category: "term_translation",
    input: { src_lang: "ru", text: "сводная таблица" },
    reference: "جدول محوري",
    rubric: "Correct standard Arabic term; English in parentheses acceptable",
    ...overrides,
  });

describe("parseItems", () => {
  it("parses one item per JSONL line and skips blank lines", () => {
    const items = parseItems(`${item()}\n\n${item({ id: "term-04" })}\n`);

    expect(items.map((i) => i.id)).toEqual(["term-03", "term-04"]);
    expect(items[0]).toEqual({
      id: "term-03",
      category: "term_translation",
      input: { src_lang: "ru", text: "сводная таблица" },
      reference: "جدول محوري",
      rubric: "Correct standard Arabic term; English in parentheses acceptable",
    });
  });

  it("names the line of an item with an unknown category", () => {
    expect(() => parseItems(`${item()}\n${item({ id: "x-1", category: "poetry" })}`)).toThrow(
      /line 2.*category/,
    );
  });

  it("rejects an item without a rubric", () => {
    expect(() => parseItems(item({ rubric: "" }))).toThrow(/line 1.*rubric/);
  });

  it("rejects duplicate ids", () => {
    expect(() => parseItems(`${item()}\n${item()}`)).toThrow(/duplicate id "term-03"/);
  });
});

describe("parseVerdict", () => {
  it("reads the judge's score and reason", () => {
    expect(
      parseVerdict(
        '{"score": 0.5, "answer_key_error": false, "reason": "term correct, no diacritics"}',
      ),
    ).toEqual({ score: 0.5, answerKeyError: false, reason: "term correct, no diacritics" });
  });

  it("scores zero when the judge finds an answer-key error", () => {
    expect(
      parseVerdict('{"score": 1, "answer_key_error": true, "reason": "Q2 key is wrong"}'),
    ).toEqual({ score: 0, answerKeyError: true, reason: "Q2 key is wrong" });
  });

  it("rejects a score outside 0, 0.5 and 1", () => {
    expect(() => parseVerdict('{"score": 0.8, "answer_key_error": false, "reason": "ok"}')).toThrow(
      /score/,
    );
  });

  it("rejects output that is not JSON", () => {
    expect(() => parseVerdict("Score: 1")).toThrow(/judge/);
  });
});

describe("summarize", () => {
  const result = (id: string, category: string, score: number, answerKeyError = false) => ({
    id,
    category: category as never,
    score,
    answerKeyError,
  });

  it("holds term translation to 0.85, above the 0.80 default bar", () => {
    // 6.5 / 8 = 0.8125: clears 0.80 but not 0.85
    const scores = [1, 1, 1, 1, 0.5, 0.5, 1, 0.5];
    const summary = summarize(scores.map((s, i) => result(`term-${i}`, "term_translation", s)));

    expect(summary.categories).toEqual([
      expect.objectContaining({
        category: "term_translation",
        score: 0.8125,
        bar: 0.85,
        passed: false,
      }),
    ]);
    expect(summary.overall).toEqual({ score: 0.8125, bar: 0.8, passed: true });
    expect(summary.passed).toBe(false);
  });

  it("fails quiz generation on any answer-key error even above the bar", () => {
    // 5 / 6 = 0.833, but one item has a wrong answer key
    const results = [1, 1, 1, 1, 1].map((s, i) => result(`quiz-${i}`, "quiz_generation", s));
    results.push(result("quiz-5", "quiz_generation", 0, true));

    expect(summarize(results).categories[0]).toMatchObject({
      score: 0.8333,
      answer_key_errors: 1,
      passed: false,
    });
  });

  it("averages overall across items, not categories, in category order", () => {
    // MSA 1, 1, 1 and Gulf 0: per-item mean 0.75; per-category mean would be 0.5
    const summary = summarize([
      result("gulf-1", "gulf_dialect", 0),
      result("msa-1", "msa_explanation", 1),
      result("msa-2", "msa_explanation", 1),
      result("msa-3", "msa_explanation", 1),
    ]);

    expect(summary.overall).toEqual({ score: 0.75, bar: 0.8, passed: false });
    expect(summary.categories.map((c) => [c.category, c.score, c.passed])).toEqual([
      ["msa_explanation", 1, true],
      ["gulf_dialect", 0, false],
    ]);
  });
});

describe("items.jsonl", () => {
  it("has at least 30 valid items covering every category", () => {
    const items = parseItems(readFileSync(join(import.meta.dirname, "items.jsonl"), "utf8"));

    expect(items.length).toBeGreaterThanOrEqual(30);
    expect(new Set(items.map((i) => i.category))).toEqual(new Set(CATEGORIES));
  });
});
