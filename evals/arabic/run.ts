// Arabic quality eval runner (#8). Usage: pnpm eval:arabic --model muse-wonder-1.0 [--judge M] [--only id,id]
// Known exception to AGENTS.md until #23 lands: trace lines are stamped with wall time, not the clock.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "../../src/config.ts";
import { loadModels, type Models } from "../../src/server/providers/models.ts";
import {
  createProvider,
  type Provider,
  type ProviderTraceEvent,
} from "../../src/server/providers/provider.ts";
import {
  type Category,
  type Item,
  parseItems,
  parseVerdict,
  round4,
  SOURCE_LANGUAGES,
  summarize,
  VERDICT_SCHEMA,
} from "./eval.ts";

const TIMEOUT_MS = 180_000;
const CONCURRENCY = 4;
const DIR = import.meta.dirname;

const DIALECT_TASK =
  "أنت مساعد تعليمي. وصلتك رسالة من متعلم قد تكون بلهجة عامية. أولًا اكتب سطرًا يبدأ بـ «المقصود:» تعيد فيه صياغة ما يقصده بالفصحى، ثم أجبه باختصار بعربية واضحة.";

const TASKS: Record<Category, (item: Item) => string> = {
  msa_explanation: () =>
    "أنت معلّم يشرح لمتعلم عربي مبتدئ. أجب بالعربية الفصحى في 3 إلى 6 جمل. يمكنك ذكر المصطلح الإنجليزي بين قوسين.",
  egyptian_dialect: () => DIALECT_TASK,
  gulf_dialect: () => DIALECT_TASK,
  term_translation: (item) =>
    `Translate this ${SOURCE_LANGUAGES[item.input.src_lang ?? "en"]} technical term into the standard Arabic term used in textbooks. Reply with the Arabic term only, optionally followed by the English term in parentheses.`,
  diacritics: () =>
    "اكتب المصطلح العربي التالي مع التشكيل الكامل على كل حرف. أجب بالمصطلح المشكول فقط.",
  quiz_generation: () =>
    'أنشئ 3 أسئلة اختيار من متعدد بالعربية من النص التالي فقط. لكل سؤال 4 خيارات وإجابة صحيحة واحدة. أجب بصيغة JSON فقط: {"questions":[{"prompt":"...","options":["...","...","...","..."],"answer_index":0}]}',
};

let tracePath = "";

function trace(event: ProviderTraceEvent) {
  appendFileSync(tracePath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

// The answering and judging models come from the command line, routed as two eval roles.
function evalModels(answer: string, judge: string): Models {
  const models = loadModels();
  const role = (model: string) => {
    if (!Object.hasOwn(models.prices, model)) {
      throw new Error(`No price for "${model}" in config/models.yaml`);
    }
    return { provider: "meta" as const, model };
  };
  return {
    ...models,
    roles: { ...models.roles, eval_answer: role(answer), eval_judge: role(judge) },
  };
}

const traceFor = (item: Item, step: "answer" | "judge") =>
  step === "answer"
    ? {
        agent: "eval",
        summary_ar: "إجابة النموذج على بند التقييم",
        summary_en: `Model answers eval item ${item.id}`,
      }
    : {
        agent: "eval",
        summary_ar: "تقييم الإجابة وفق المعايير",
        summary_en: `Judge scores the answer to ${item.id} against the rubric`,
      };

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

async function evaluate(provider: Provider, item: Item) {
  try {
    const { text: answer } = await provider.chat({
      role: "eval_answer",
      trace: traceFor(item, "answer"),
      instructions: TASKS[item.category](item),
      input: item.input.text,
    });
    const verdict = await provider.structured({
      role: "eval_judge",
      trace: traceFor(item, "judge"),
      input: judgeInstructions(item, answer),
      schema: { name: "verdict", schema: VERDICT_SCHEMA },
    });
    return {
      id: item.id,
      category: item.category,
      ...parseVerdict(verdict.text, item.category),
      answer,
    };
  } catch (e) {
    console.warn(`  ${item.id}: ${e}`);
    return {
      id: item.id,
      category: item.category,
      score: 0,
      judgeScore: null,
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
  const provider = createProvider({
    models: evalModels(model, judge),
    profile: config.providerProfile,
    apiKey: config.modelApiKey,
    fixturesDir: join(DIR, "fixtures"),
    onTrace: trace,
    timeoutMs: TIMEOUT_MS,
  });

  const only = values.only?.split(",");
  const items = parseItems(readFileSync(join(DIR, "items.jsonl"), "utf8")).filter(
    (item) => !only || only.includes(item.id),
  );
  const runAt = new Date().toISOString();
  // A --only run gets its own file so it never overwrites a full run's results.
  const suffix = only ? "-partial" : "";
  const stem = join(DIR, `results-${new Date().toLocaleDateString("en-CA")}-${model}${suffix}`);
  tracePath = `${stem}.trace.jsonl`;
  writeFileSync(tracePath, "");

  console.log(`Evaluating ${items.length} items on ${model} (judge ${judge})`);
  const results = await mapLimited(items, CONCURRENCY, (item) => evaluate(provider, item));
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
        cost_usd: round4(provider.totalCostUsd()),
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
  console.log(`Cost $${provider.totalCostUsd().toFixed(4)}, ${errors} errors. Wrote ${stem}.json`);
}

await main();
