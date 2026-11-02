// Arabic display names and one-line jobs for the agents in trace events, keyed by the `agent` field.
// The orchestrator has no name of its own: it emits a step's start, retry, failure and output under
// the agent's name (src/server/orchestrator/orchestrator.ts).

type AgentInfo = { name: string; job: string };

// Learner-facing names. The planning agent is المهندس in every UI string (the feed, the drawer,
// the plan's building copy); do not also call it المعماري.
export const AGENTS: Readonly<Record<string, AgentInfo>> = {
  intake: { name: "المحاور", job: "يفهم هدفك ووقتك" },
  scout: { name: "الكشّاف", job: "يبحث عن مصادر مفتوحة الترخيص ويتحقق من تراخيصها في الكود" },
  architect: { name: "المهندس", job: "يصمم خطة الدورة على قدر وقتك" },
  lesson_builder: { name: "صانع الدروس", job: "يكتب دروسًا عربية بجانب نصها الأصلي" },
  examiner: { name: "الممتحن", job: "يكتب اختبارات تجتازها عند ٨٠٪" },
  diagrams: { name: "مُعرِّب الرسوم", job: "يكتب نصوص رسوم المصادر بالعربية إن سمح ترخيصها" },
  coach: { name: "المدرب", job: "يتابعك ضمن الحدود التي اخترتها" },
  replanner: { name: "مُعيد التخطيط", job: "يعدّل خطتك حين تعود بعد غياب" },
  dummy: { name: "وكيل تجريبي", job: "يجرّب خطوات النظام دون أن يستدعي نموذجًا" },
  // Not agents: the clock module and the notifier trace their decisions under these names.
  clock: { name: "الساعة المحاكاة", job: "تقدّم الوقت في العرض التجريبي" },
  scheduler: { name: "جدول المدرب", job: "يُطلق رسائل المدرب حين يحلّ موعدها" },
  notifier: { name: "قناة الرسائل", job: "ترسل الرسائل ضمن موافقتك وساعات الهدوء" },
  sim: { name: "العرض التجريبي", job: "يعيد العرض إلى بياناته التجريبية" },
};

const UNKNOWN_AGENT = "وكيل";

export function agentName(agent: string): string {
  return AGENTS[agent]?.name ?? UNKNOWN_AGENT;
}

export function agentJob(agent: string): string | undefined {
  return AGENTS[agent]?.job;
}
