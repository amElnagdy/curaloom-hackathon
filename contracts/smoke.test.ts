// Proves Meta's strict json_schema mode accepts each agent-output contract and that what the model
// returns validates. CI replays recorded responses; re-record with `pnpm fixtures:record` after
// changing a contract (a changed schema is a new request, so replay fails until re-recorded).

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { loadModels } from "../src/server/providers/models";
import { createProvider } from "../src/server/providers/provider";
import { AGENT_OUTPUTS, CONTRACTS, type ContractName, contractErrors } from "./index";

// RECORD_FIXTURES is a test-only switch set by `pnpm fixtures:record`, not an app setting, so it is
// read here rather than in src/config.ts.
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

const provider = createProvider({
  models: loadModels(),
  profile: recording ? "record" : "replay",
  apiKey: loadConfig(process.env).modelApiKey,
});

const LEARNER =
  "المتعلم: عمر، 28 سنة، محاسب في الرياض يريد أن يصبح محلل بيانات مبتدئًا، لديه 5 ساعات أسبوعيًا، ويقرأ الإنجليزية. الموضوع: أساسيات جداول البيانات.";

const PROMPTS: Record<(typeof AGENT_OUTPUTS)[number], { role: string; input: string }> = {
  LearnerProfile: {
    role: "agent_default",
    input: `${LEARNER} قال بلهجته: «أبي أتعلم تحليل البيانات، بس لا تطرشون لي رسايل الصبح». املأ ملفه.`,
  },
  Resource: {
    role: "agent_default",
    input: `${LEARNER} صف مصدرًا تعليميًا مفتوح الترخيص واحدًا مناسبًا له بالإنجليزية.`,
  },
  CoursePlan: {
    role: "curriculum",
    input: `${LEARNER} ضع خطة: طريق من 3 وحدات وأسبوعين ملتزمين بجلسات من 45 دقيقة.`,
  },
  Lesson: {
    role: "agent_default",
    input: `${LEARNER} اكتب درسًا قصيرًا عن الجدول المحوري بقسم واحد، مع مقتطف إنجليزي قصير من المصدر r1.`,
  },
  GlossaryEntry: {
    role: "agent_default",
    input: "أنشئ مدخل مسرد للمصطلح الإنجليزي pivot table بالعربية مع التشكيل الكامل.",
  },
  Quiz: {
    role: "agent_default",
    input: "أنشئ اختبارًا من سؤالين (اختيار من متعدد وإجابة قصيرة) لدرس L1 عن الجدول المحوري.",
  },
  QuizAttempt: {
    role: "agent_default",
    input:
      "صحّح محاولة الاختبار q1 لدرس L1 في اليوم 3. السؤال i1 (اختيار من متعدد، الإجابة: تلخيص البيانات بتجميعها) وأجاب المتعلم: «تلخيص البيانات بتجميعها». السؤال i2 (إجابة قصيرة: مثال من العمل) وأجاب: «أجمع المصروفات حسب القسم». حد النجاح 0.8.",
  },
  CoachEvent: {
    role: "agent_default",
    input: `${LEARNER} لم يدخل منذ يومين. اكتب رسالة تذكير قصيرة له في اليوم الثاني.`,
  },
};

describe.each(AGENT_OUTPUTS)("%s", (name: ContractName) => {
  it("is accepted by Meta as a strict response format and the output validates", async () => {
    const { role, input } = PROMPTS[name as keyof typeof PROMPTS];
    const result = await provider.structured({
      role,
      trace: {
        agent: "contract_smoke",
        summary_ar: `اختبار عقد ${name}`,
        summary_en: `Smoke test for the ${name} contract`,
      },
      instructions: "أجب بالعربية حيث يكون النص موجّهًا للمتعلم.",
      input,
      schema: { name, schema: CONTRACTS[name] },
    });

    expect(contractErrors(CONTRACTS[name], result.json)).toEqual([]);
  }, 180_000);
});
