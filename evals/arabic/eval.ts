// Pure parts of the Arabic quality eval (#8): item loading, judge parsing, scoring.

export const CATEGORIES = [
  "msa_explanation",
  "egyptian_dialect",
  "gulf_dialect",
  "term_translation",
  "diacritics",
  "quiz_generation",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Item = {
  id: string;
  category: Category;
  input: { text: string; src_lang?: string };
  reference: string;
  rubric: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseItem(raw: Record<string, unknown>, fail: (msg: string) => never): Item {
  const { id, category, input, reference, rubric } = raw;
  if (!isNonEmptyString(id)) fail("missing id");
  if (!(CATEGORIES as readonly unknown[]).includes(category)) fail(`unknown category ${category}`);
  const { text, src_lang } = (input ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(text)) fail("missing input.text");
  if (src_lang !== undefined && !isNonEmptyString(src_lang)) fail("invalid input.src_lang");
  if (!isNonEmptyString(reference)) fail("missing reference");
  if (!isNonEmptyString(rubric)) fail("missing rubric");
  return {
    id,
    category: category as Category,
    input: src_lang === undefined ? { text } : { src_lang, text },
    reference,
    rubric,
  };
}

export function parseItems(jsonl: string): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  jsonl.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const fail = (msg: string): never => {
      throw new Error(`items.jsonl line ${index + 1}: ${msg}`);
    };
    const item = parseItem(JSON.parse(line), fail);
    if (seen.has(item.id)) fail(`duplicate id "${item.id}"`);
    seen.add(item.id);
    items.push(item);
  });
  return items;
}

export type Verdict = { score: number; answerKeyError: boolean; reason: string };

// JSON Schema the judge must answer with (Responses API text.format).
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "answer_key_error", "reason"],
  properties: {
    score: { type: "number", enum: [0, 0.5, 1] },
    answer_key_error: { type: "boolean" },
    reason: { type: "string" },
  },
} as const;

export function parseVerdict(text: string): Verdict {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`judge returned non-JSON output: ${text.slice(0, 80)}`);
  }
  const { score, answer_key_error, reason } = raw;
  if (score !== 0 && score !== 0.5 && score !== 1) {
    throw new Error(`judge score must be 0, 0.5 or 1; got ${score}`);
  }
  if (typeof answer_key_error !== "boolean" || typeof reason !== "string") {
    throw new Error("judge output is missing answer_key_error or reason");
  }
  return { score: answer_key_error ? 0 : score, answerKeyError: answer_key_error, reason };
}

// Pass bars from #8: overall 0.80, term translation 0.85, quiz validity 0.80 with no answer-key errors.
export const DEFAULT_BAR = 0.8;
const CATEGORY_BARS: Partial<Record<Category, number>> = { term_translation: 0.85 };

export type ItemResult = { id: string; category: Category; score: number; answerKeyError: boolean };

export type CategorySummary<R extends ItemResult> = {
  category: Category;
  score: number;
  bar: number;
  passed: boolean;
  answer_key_errors: number;
  item_scores: R[];
};

const mean = (scores: number[]) =>
  Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10_000) / 10_000;

export function summarize<R extends ItemResult>(results: R[]) {
  const categories: CategorySummary<R>[] = CATEGORIES.flatMap((category) => {
    const items = results.filter((r) => r.category === category);
    if (items.length === 0) return [];
    const score = mean(items.map((r) => r.score));
    const bar = CATEGORY_BARS[category] ?? DEFAULT_BAR;
    const answerKeyErrors = items.filter((r) => r.answerKeyError).length;
    return [
      {
        category,
        score,
        bar,
        passed: score >= bar && answerKeyErrors === 0,
        answer_key_errors: answerKeyErrors,
        item_scores: items,
      },
    ];
  });
  const overallScore = mean(results.map((r) => r.score));
  const overall = { score: overallScore, bar: DEFAULT_BAR, passed: overallScore >= DEFAULT_BAR };
  return { overall, categories, passed: overall.passed && categories.every((c) => c.passed) };
}
