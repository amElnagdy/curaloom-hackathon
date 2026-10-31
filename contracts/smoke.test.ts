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

const ARABIC = "أجب بالعربية حيث يكون النص موجّهًا للمتعلم.";

// The scout's own prompts are in scout.ts. These two calls were recorded with no instructions.
const SCOUT_LEARNER =
  "Topic: spreadsheet basics\nThe learner's goal: محلل بيانات مبتدئ\nLevel: beginner";

type Prompt = { role: string; instructions?: string; input: string };

const PROMPTS: Record<(typeof AGENT_OUTPUTS)[number], Prompt> = {
  LearnerProfile: {
    role: "agent_default",
    instructions: ARABIC,
    input: `${LEARNER} قال بلهجته: «أبي أتعلم تحليل البيانات، بس لا تطرشون لي رسايل الصبح». املأ ملفه.`,
  },
  IntakeReply: {
    role: "agent_default",
    input:
      "Topic: spreadsheet basics\nStill missing: hours_per_week, source_langs_ok, history_notes\n\nConversation so far:\nInterviewer: أهلًا عمر! ما الذي تريد أن تصل إليه، وما عملك الآن؟\nLearner: أنا محاسب بالرياض وأبي أصير محلل بيانات، وعندي خمس ساعات بالأسبوع",
  },
  Diagnostic: {
    role: "agent_default",
    input:
      "Write three multiple-choice questions in Arabic, four options each, that check what a learner knows about: spreadsheet basics",
  },
  ScoutQueries: {
    role: "agent_default",
    input: `Write two web search queries per language for open learning resources.\n${SCOUT_LEARNER}\nLanguages: en, ru, zh, fr`,
  },
  Candidates: {
    role: "agent_default",
    input: `Describe each cited page for this learner; why_ar is in Arabic.\n${SCOUT_LEARNER}\n\nCited pages:\n1. https://en.wikipedia.org/wiki/Spreadsheet | Spreadsheet - Wikipedia\n2. https://en.wikibooks.org/wiki/LibreOffice_Calc | LibreOffice Calc - Wikibooks`,
  },
  PlanDraft: {
    role: "curriculum",
    instructions: ARABIC,
    input: `${LEARNER} المصادر: r1 (مقال إنجليزي عن الجداول المحورية)، r2 (كتاب روسي عن الإحصاء الوصفي). ضع طريقًا من 3 وحدات، ودروس الأسبوعين الأولين فقط بجلسات من 40 دقيقة في الأيام 0 إلى 13.`,
  },
  LessonDraft: {
    role: "agent_default",
    instructions: ARABIC,
    input: `${LEARNER} اكتب درسًا قصيرًا عن الجدول المحوري بقسم واحد يقتبس الجملتين 1 و2 من المصدر r1، ومدخل مسرد واحد للمصطلح pivot table بالعربية مع التشكيل الكامل.\n\n### r1 | en | Pivot table\n[1] A pivot table is a table of values which are aggregations of groups of individual values from a more extensive table.\n[2] It lets the user summarize the data by the categories they choose.`,
  },
  QuizDraft: {
    role: "agent_default",
    instructions: ARABIC,
    input:
      "اكتب اختبارًا من سؤالين لدرس عن الجدول المحوري: سؤال اختيار من متعدد بأربعة خيارات، وسؤال إجابة قصيرة. مصطلح المسرد الوحيد g1 (جدول محوري).",
  },
  KeyCheck: {
    role: "judge",
    input:
      "Answer each multiple-choice item from the lesson alone; copy the option exactly.\n\nLesson: الجدول المحوري يلخص جدولًا كبيرًا بتجميع صفوفه حسب فئة وحساب الإجمالي.\n\ni1. ما الغرض من الجدول المحوري؟\n- تلخيص البيانات بتجميعها\n- رسم المخططات فقط\n- حذف الصفوف المكررة\n- تنسيق الخلايا",
  },
  ShortGrades: {
    role: "judge",
    instructions: ARABIC,
    input:
      "Grade the short answer by its rubric.\n\ni2. اذكر مثالًا من عملك يمكن تلخيصه بجدول محوري.\nRubric: تُقبل أي حالة فيها تجميع بيانات حسب فئة وحساب مجموع أو متوسط.\nAnswer: أجمع المصروفات حسب القسم وأطلع مجموع كل قسم",
  },
  CoachDraft: {
    role: "coach",
    instructions: ARABIC,
    input:
      "لم يدرس المتعلم منذ يومين. اكتب له رسالة تذكير قصيرة تقترح مهمة من عشر دقائق، واكتب {name} مرة واحدة مكان اسمه.",
  },
  ReplanNote: {
    role: "replan",
    instructions: ARABIC,
    input:
      "عاد المتعلم بعد عشرة أيام وطلب جلسات أقصر، فرتّبنا خطته من اليوم ١٠: مراجعة قصيرة للدرس الأول أولًا، وأسبوع أول أخف من ٥٥ دقيقة والحد ٨٤. اشرح له ذلك في جملتين، واجعل resource_id فارغًا (null) لأنه لم يطلب مصدرًا آخر.",
  },
  DiagramLabels: {
    role: "diagram_labels",
    input:
      "A 600x200 diagram of a pivot table has these text blocks: 'Region' at the top left, 'Sum of Sales' at the top right, 'North' and 'South' below 'Region'. Give each block, its Arabic translation and its box as [x, y, width, height]. Glossary: pivot table = جدول محوري.",
  },
  ImageTexts: {
    role: "image_text",
    input:
      "Transcribe these text blocks of a diagram, one per item, exactly as written: 'المنطقة', 'مجموع المبيعات', 'الشمال', 'الجنوب'.",
  },
};

describe.each(AGENT_OUTPUTS)("%s", (name: ContractName) => {
  it("is accepted by Meta as a strict response format and the output validates", async () => {
    const { role, instructions, input } = PROMPTS[name as keyof typeof PROMPTS];
    const result = await provider.structured({
      role,
      trace: {
        agent: "contract_smoke",
        summary_ar: `اختبار عقد ${name}`,
        summary_en: `Smoke test for the ${name} contract`,
      },
      instructions,
      input,
      schema: { name, schema: CONTRACTS[name] },
    });

    expect(contractErrors(CONTRACTS[name], result.json)).toEqual([]);
  }, 300_000);
});
