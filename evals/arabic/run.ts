// Arabic quality eval runner (#8). Usage: pnpm eval:arabic --model muse-wonder-1.0 [--judge M] [--only id,id]
// Calls /responses directly; this moves onto the provider layer (#12) once it exists.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "../../src/config.ts";
import {
  type Category,
  type Item,
  parseItems,
  parseVerdict,
  summarize,
  VERDICT_SCHEMA,
} from "./eval.ts";

const BASE_URL = "https://api.meta.ai/v1";
const TIMEOUT_MS = 180_000;
const CONCURRENCY = 4;
const DIR = import.meta.dirname;

// USD per 1M tokens (input, cached input, output), standard mode.
const PRICES: Record<string, [number, number, number]> = {
  "muse-spark-1.3": [1.25, 0.15, 4.25],
  "muse-wonder-1.0": [4.0, 0.2, 20.0],
};

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ru: "Russian",
  zh: "Chinese",
  fr: "French",
};

const DIALECT_TASK =
  "أنت مساعد تعليمي. وصلتك رسالة من متعلم قد تكون بلهجة عامية. أولًا اكتب سطرًا يبدأ بـ «المقصود:» تعيد فيه صياغة ما يقصده بالفصحى، ثم أجبه باختصار بعربية واضحة.";

const TASKS: Record<Category, (item: Item) => string> = {
  msa_explanation: () =>
    "أنت معلّم يشرح لمتعلم عربي مبتدئ. أجب بالعربية الفصحى في 3 إلى 6 جمل. يمكنك ذكر المصطلح الإنجليزي بين قوسين.",
  egyptian_dialect: () => DIALECT_TASK,
  gulf_dialect: () => DIALECT_TASK,
  term_translation: (item) =>
    `Translate this ${LANG_NAMES[item.input.src_lang ?? "en"]} technical term into the standard Arabic term used in textbooks. Reply with the Arabic term only, optionally followed by the English term in parentheses.`,
  diacritics: () =>
    "اكتب المصطلح العربي التالي مع التشكيل الكامل على كل حرف. أجب بالمصطلح المشكول فقط.",
  quiz_generation: () =>
    'أنشئ 3 أسئلة اختيار من متعدد بالعربية من النص التالي فقط. لكل سؤال 4 خيارات وإجابة صحيحة واحدة. أجب بصيغة JSON فقط: {"questions":[{"prompt":"...","options":["...","...","...","..."],"answer_index":0}]}',
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};
type OutputItem = { type: string; phase?: string; content?: { type: string; text?: string }[] };

function costUsd(model: string, usage: Usage): number {
  const [input, cached, output] = PRICES[model] ?? [0, 0, 0];
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const fresh = (usage.input_tokens ?? 0) - cachedTokens;
  return (fresh * input + cachedTokens * cached + (usage.output_tokens ?? 0) * output) / 1_000_000;
}

// The final answer is the last `message` item without a `phase` (interim ones are "commentary").
function outputText(output: OutputItem[]): string {
  const message = output.filter((o) => o.type === "message" && !o.phase).at(-1);
  return (message?.content ?? []).map((c) => c.text ?? "").join("");
}

let tracePath = "";
let totalCost = 0;

async function respond(role: "answer" | "judge", itemId: string, body: Record<string, unknown>) {
  const model = body.model as string;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let error: string | undefined;
    try {
      const res = await fetch(`${BASE_URL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.modelApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = await res.json();
      if (res.ok) {
        const usage: Usage = json.usage ?? {};
        const cost = costUsd(model, usage);
        totalCost += cost;
        trace({
          role,
          itemId,
          model,
          ok: true,
          latency_ms: Date.now() - started,
          usage,
          cost_usd: cost,
        });
        return outputText(json.output ?? []);
      }
      error = `HTTP ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 200)}`;
    } catch (e) {
      error = String(e);
    }
    trace({ role, itemId, model, ok: false, latency_ms: Date.now() - started, error });
    if (attempt === 2) throw new Error(error);
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
  }
}

function trace(event: Record<string, unknown>) {
  appendFileSync(
    tracePath,
    `${JSON.stringify({ ts: new Date().toISOString(), kind: "model_call", ...event })}\n`,
  );
}

function judgeInstructions(item: Item, answer: string): string {
  return [
    "You grade answers from an Arabic learning assistant against a rubric. Be strict and consistent.",
    `Category: ${item.category}`,
    `Task given to the assistant: ${TASKS[item.category](item)}`,
    `Input: ${item.input.text}`,
    `Reference: ${item.reference}`,
    `Rubric: ${item.rubric}`,
    `Assistant answer:\n${answer}`,
    "Return score 0, 0.5 or 1 per the rubric. Set answer_key_error to true only for a quiz whose answer key is wrong or ambiguous. Give the reason in one short English sentence.",
  ].join("\n\n");
}

async function evaluate(item: Item, model: string, judge: string) {
  try {
    const answer = await respond("answer", item.id, {
      model,
      instructions: TASKS[item.category](item),
      input: item.input.text,
    });
    const verdictText = await respond("judge", item.id, {
      model: judge,
      input: judgeInstructions(item, answer),
      text: {
        format: { type: "json_schema", name: "verdict", strict: true, schema: VERDICT_SCHEMA },
      },
    });
    return { id: item.id, category: item.category, ...parseVerdict(verdictText), answer };
  } catch (e) {
    console.warn(`  ${item.id}: ${e}`);
    return {
      id: item.id,
      category: item.category,
      score: 0,
      answerKeyError: false,
      reason: `error: ${e}`,
      answer: "",
    };
  }
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "muse-spark-1.3" },
      judge: { type: "string", default: "muse-spark-1.3" },
      only: { type: "string" },
    },
  });
  const { model, judge } = values;
  if (!config.modelApiKey)
    throw new Error("MODEL_API_KEY is not set; copy config/.env.example to .env");

  const only = values.only?.split(",");
  const items = parseItems(readFileSync(join(DIR, "items.jsonl"), "utf8")).filter(
    (item) => !only || only.includes(item.id),
  );
  const runAt = new Date().toISOString();
  const stem = join(DIR, `results-${new Date().toLocaleDateString("en-CA")}-${model}`);
  tracePath = `${stem}.trace.jsonl`;
  writeFileSync(tracePath, "");

  console.log(`Evaluating ${items.length} items on ${model} (judge ${judge})`);
  const results = await mapLimited(items, CONCURRENCY, (item) => evaluate(item, model, judge));
  const summary = summarize(results);
  const errors = results.filter((r) => r.reason.startsWith("error:")).length;

  writeFileSync(
    `${stem}.json`,
    `${JSON.stringify(
      {
        model,
        judge,
        run_at: runAt,
        item_count: items.length,
        errors,
        cost_usd: Math.round(totalCost * 10_000) / 10_000,
        passed: summary.passed,
        overall: summary.overall,
        categories: summary.categories.map((c) => ({ model, ...c })),
      },
      null,
      2,
    )}\n`,
  );

  for (const c of summary.categories) {
    console.log(
      `  ${c.passed ? "PASS" : "FAIL"} ${c.category.padEnd(18)} ${c.score.toFixed(2)} (bar ${c.bar})`,
    );
  }
  const { overall } = summary;
  console.log(
    `  ${overall.passed ? "PASS" : "FAIL"} ${"overall".padEnd(18)} ${overall.score.toFixed(2)} (bar ${overall.bar})`,
  );
  console.log(`Result: ${summary.passed ? "PASS" : "FAIL (a category is below its bar)"}`);
  console.log(`Cost $${totalCost.toFixed(4)}, ${errors} errors. Wrote ${stem}.json`);
}

await main();
