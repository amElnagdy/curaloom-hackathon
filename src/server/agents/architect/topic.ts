// The plan rules check a plan's shape, not its subject (#109). In one recording the curriculum model
// wrote a plan that kept every rule while its rationale and first lessons came from other
// conversations («طلبت مني تغيير اسمي إلى ريتا», «فوز القضية»). This check needs no model call: it
// looks for the subject's words in the rationale and in each committed lesson's title.

import type { CoursePlan } from "../../../../contracts/index.ts";
import type { AgentContext } from "../../orchestrator/orchestrator.ts";

// What a plan is checked against. The scout kept each resource for the topic, so their titles and
// its Arabic reasons give the topic's words in Arabic even when the learner wrote it in English.
export type Subject = {
  topic: string;
  goal: string;
  resources: { title: string; why_ar: string }[];
};

// A part of the plan that is not about the subject: in English for the model's retry and the
// trace, and in Arabic for the learner.
export type Stray = { en: string; ar: string };

const ARTICLES = ["وال", "بال", "كال", "فال", "لل", "ال"];
const SUFFIXES = ["ك", "ها", "ان", "ات", "ون", "ين", "يه", "ه", "ي"];

// Larkey's Light10 stemmer, with «ك» added for words addressed to the learner: a leading «و»,
// then an article, then each suffix once, in order.
function lightStem(word: string): string {
  let w = word.length > 3 && word.startsWith("و") ? word.slice(1) : word;
  const article = ARTICLES.find((a) => w.startsWith(a) && w.length - a.length >= 2);
  if (article) w = w.slice(article.length);
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 2) w = w.slice(0, -s.length);
  }
  return w;
}

// Each word of a text as the stems it may have, so that spellings of one word meet. Arabic loses
// its short vowels and tatweel, its alefs become «ا», «ى» becomes «ي» and «ة» becomes «ه». A word
// that starts with «ب», «ل», «ك» or «ف» may also be that letter and a word («لتلخيص», «تلخيص»).
// Latin is lowercased. Stems under three letters, and words in other scripts, say nothing here.
function stemsOf(text: string): string[][] {
  const folded = text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  return [...folded.matchAll(/[ء-ي]+|[a-z]+/g)]
    .map(([word]) => {
      const stems = [lightStem(word)];
      if (word.length >= 5 && "بلكف".includes(word.charAt(0))) stems.push(lightStem(word.slice(1)));
      return stems.filter((s) => s.length >= 3);
    })
    .filter((stems) => stems.length);
}

const stemSet = (text: string) => new Set(stemsOf(text).flat());

// Words about the course's pace and parts, which a rationale explains the plan by.
const PACE = stemSet(`
  جلسة جلسات جلستين أسبوع أسابيع أسبوعين يوم أيام دقيقة دقائق ساعة ساعات وقت درس دروس وحدة وحدات
  دورة دورات قصيرة طويلة
`);

// Function words, and words about learning, levels and sources in general: they say how a course
// teaches, not what it teaches, so the scout's reasons share them with any subject.
const GENERAL = stemSet(`
  هذا هذه ذلك تلك التي الذي الذين على إلى حتى بين قبل بعد عند عبر دون غير مثل حول نحو خلال ضمن
  كيف لماذا متى أين لأن لأنها لأنه لأنك إذا لكن ليس كان تكون يكون أنت أنها أنه عليه عليها فيه فيها
  منه منها إليه كما مما بما أيضا فقط بعض كبير كبيرة صغير صغيرة
  مستوى مستواك مبتدئ مبتدئين متوسط متقدم أساس أساسي أساسية أساسيات مقدمة مدخل مفهوم مبدأ مبادئ
  فهم تعلم تعليم متعلم شرح تشرح يشرح توضح توضيح تقدم تعرف صفحة مقالة كتاب مصدر مصادر دليل فصل
  مثال أمثلة خطوة خطوات طريقة بسيط بسيطة مبسطة سهل سهلة سريع سريعة واضح تناسب يناسب مناسب
  مناسبة مثالية تساعد يساعد تمنح تبني تبدأ مراجعة تطبيق تطبيقي عملي عمليا عملية تمرين تمارين
  مشروع اختبار أول أولى ثاني ثانية جديد مهارة مهارات بناء إنشاء إعداد عمل استخدام لغة بداية هدف
  طريق رحلة مسار تحول تصبح إتقان ثقة بيئة نظري ضروري لازم شامل كامل متكامل
  the and for with from into how what about
`);

// A word says nothing of the subject when any of its stems is general or about the pace.
const canNameSubject = (stems: string[]) => !stems.some((s) => GENERAL.has(s) || PACE.has(s));

function subjectStems(subject: Subject): Set<string> {
  const text = [
    subject.topic,
    subject.goal,
    ...subject.resources.flatMap((r) => [r.title, r.why_ar]),
  ];
  return new Set(stemsOf(text.join("\n")).filter(canNameSubject).flat());
}

const mentions = (text: string, vocabulary: Set<string>) =>
  stemsOf(text).some((stems) => canNameSubject(stems) && stems.some((s) => vocabulary.has(s)));

const talksPace = (text: string) => stemsOf(text).some((stems) => stems.some((s) => PACE.has(s)));

// The parts of the plan that are not about the subject: the rationale, then each committed lesson.
// A lesson can be on the subject in words neither the learner nor the scout used («تنظيم الحقول
// والصفوف والأعمدة والقيم» in a recorded pivot-table plan), so the plan is off its topic only when
// its rationale is, or more than half of its lessons are.
export function topicVerdict(
  plan: CoursePlan,
  subject: Subject,
): { off: boolean; strays: Stray[] } {
  const vocabulary = subjectStems(subject);
  const offRationale = !mentions(plan.rationale_ar, vocabulary) && !talksPace(plan.rationale_ar);
  const { lessons } = plan.committed;
  const offLessons = lessons.flatMap((lesson, i) =>
    mentions(lesson.title_ar, vocabulary)
      ? []
      : {
          en: `lesson ${lesson.id} "${lesson.title_ar}" is not about the topic`,
          ar: `الدرس ${i + 1}`,
        },
  );
  const strays = [
    ...(offRationale
      ? [
          {
            en: "the rationale is about neither the topic nor the course",
            ar: "فقرة «لماذا هكذا؟»",
          },
        ]
      : []),
    ...offLessons,
  ];
  return { off: offRationale || offLessons.length * 2 > lessons.length, strays };
}

// The architect's check of a plan that keeps the plan rules. A first attempt off its topic fails,
// so the orchestrator's one retry sends the strays back to the model. A retry still off its topic
// keeps the plan, flagged in the trace, rather than leave the learner without one.
export function checkTopic(ctx: AgentContext, plan: CoursePlan, subject: Subject): void {
  const { off, strays } = topicVerdict(plan, subject);
  const en = strays.map((s) => s.en).join("; ");
  if (!off) {
    ctx.trace({
      kind: "decision",
      summary_ar: "تحقّق من أن خطتك تخص موضوعك",
      summary_en: `Topic check passed for the rationale and ${plan.committed.lessons.length} lessons${en && `, though ${en}`}`,
    });
    return;
  }
  const ar = strays.map((s) => s.ar).join("، و");
  if (ctx.feedback) {
    ctx.trace({
      kind: "error",
      summary_ar: `في خطتك بعد إعادة المحاولة ما لا يخص موضوعك: ${ar}، فراجعه قبل أن تبدأ`,
      summary_en: `Topic check failed on the retry; keeping the plan, flagged: ${en}`,
    });
    return;
  }
  ctx.trace({
    kind: "decision",
    summary_ar: `وجد في مسودة خطتك الأولى ما لا يخص موضوعك: ${ar}`,
    summary_en: `Topic check failed: ${en}`,
  });
  throw new Error(`The plan is not about the learner's topic, "${subject.topic}": ${en}`);
}
