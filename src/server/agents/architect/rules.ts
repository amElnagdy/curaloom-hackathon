// The rules every version of a course plan keeps (#18). The architect checks the model's draft
// against them, and a learner's edit is checked the same way before it becomes a new version. Each
// broken rule is told in English, for the model's retry, and in Arabic, for the learner.

import type { CoursePlan } from "../../../../contracts/index.ts";

type Session = CoursePlan["committed"]["sessions"][number];

// What a plan must fit: the learner's weekly time and the resources the scout found.
export type Limits = { budget_minutes: number; resource_ids: string[] };
export type Violation = { en: string; ar: string };

export type PlanEdit =
  | { op: "move"; session_id: string; day: number }
  | { op: "shorten"; session_id: string; minutes: number };
export type EditResult = { ok: true; plan: CoursePlan } | { ok: false; violations: Violation[] };

export const SESSION_MINUTES = { min: 10, max: 90 };

const WEEK_AR = ["الأول", "الثاني"];

// The simulated days [from, to) a module covers: the first starts on day 0, and each next one when
// the one before it ends.
export function moduleDays(
  plan: CoursePlan,
  index: number,
): { from: number; to: number } | undefined {
  let from = 0;
  for (const [i, step] of plan.road.entries()) {
    const to = from + step.weeks * 7;
    if (i === index) return { from, to };
    from = to;
  }
  return undefined;
}

// Minutes of sessions in each committed week, the first week first.
export const weekMinutes = (plan: CoursePlan): number[] =>
  Array.from({ length: plan.committed.weeks }, (_, week) =>
    plan.committed.sessions
      .filter((s) => Math.floor(s.day / 7) === week)
      .reduce((sum, s) => sum + s.minutes, 0),
  );

const lastDay = (plan: CoursePlan) => plan.committed.weeks * 7 - 1;
const inWindow = (plan: CoursePlan, s: Session) => s.day >= 0 && s.day <= lastDay(plan);

type Rule = (plan: CoursePlan, limits: Limits) => Violation[];

const RULES: Rule[] = [
  // Each committed week fits the learner's weekly time.
  (plan, { budget_minutes }) =>
    weekMinutes(plan).flatMap((used, week) => {
      if (used <= budget_minutes) return [];
      return {
        en: `week ${week + 1} has ${used} minutes of sessions, over the learner's ${budget_minutes} minutes a week`,
        ar: `جلسات الأسبوع ${WEEK_AR[week] ?? ""} أطول من وقتك في الأسبوع`,
      };
    }),
  // Every session teaches from at least one resource, and only from resources the scout found.
  (plan, { resource_ids }) =>
    plan.committed.sessions.flatMap((s) => {
      if (!s.resource_ids.length) {
        return { en: `session ${s.id} names no resource`, ar: "جلسة بلا مصدر" };
      }
      return s.resource_ids
        .filter((id) => !resource_ids.includes(id))
        .map((id) => ({
          en: `session ${s.id} names ${id}, which is not among the scout's resources`,
          ar: "جلسة تذكر مصدرًا لم يجده الكشّاف",
        }));
    }),
  // Every session falls in the committed weeks.
  (plan) =>
    plan.committed.sessions
      .filter((s) => !inWindow(plan, s))
      .map((s) => ({
        en: `session ${s.id} is on day ${s.day}, outside the committed days 0 to ${lastDay(plan)}`,
        ar: "هذا اليوم خارج أسبوعيك الأولين",
      })),
  // A session in the committed weeks falls in its module's weeks, so the road and the calendar agree.
  (plan) =>
    plan.committed.sessions
      .filter((s) => inWindow(plan, s))
      .flatMap((s) => {
        const lesson = plan.committed.lessons.find((l) => l.id === s.lesson_id);
        const days = lesson && moduleDays(plan, lesson.module);
        if (!days || (s.day >= days.from && s.day < days.to)) return [];
        return {
          en: `session ${s.id} is on day ${s.day}, outside its module's days ${days.from} to ${days.to - 1}`,
          ar: "هذا اليوم خارج أسابيع وحدة هذا الدرس",
        };
      }),
  (plan) =>
    plan.committed.sessions
      .filter((s) => s.minutes < SESSION_MINUTES.min || s.minutes > SESSION_MINUTES.max)
      .map((s) => ({
        en: `session ${s.id} is ${s.minutes} minutes; a session takes ${SESSION_MINUTES.min} to ${SESSION_MINUTES.max}`,
        ar: "مدة هذه الجلسة لا تصلح لجلسة واحدة",
      })),
  (plan) =>
    plan.committed.sessions
      .filter((s) => !plan.committed.lessons.some((l) => l.id === s.lesson_id))
      .map((s) => ({
        en: `session ${s.id} belongs to lesson ${s.lesson_id}, which the plan does not have`,
        ar: "جلسة لدرس ليس في الخطة",
      })),
  (plan) =>
    plan.committed.lessons.flatMap((l) => {
      if (!moduleDays(plan, l.module)) {
        return {
          en: `lesson ${l.id} is in module ${l.module}, but the road has ${plan.road.length} modules`,
          ar: "درس في وحدة ليست في الطريق",
        };
      }
      if (!plan.committed.sessions.some((s) => s.lesson_id === l.id)) {
        return { en: `lesson ${l.id} has no session`, ar: "درس بلا جلسة" };
      }
      return [];
    }),
  // A module that starts in the committed weeks has lessons there, so those weeks are planned.
  (plan) =>
    plan.road.flatMap((step, i) => {
      const days = moduleDays(plan, i);
      if (!days || days.from > lastDay(plan)) return [];
      if (plan.committed.lessons.some((l) => l.module === i)) return [];
      return {
        en: `module "${step.module}" starts on day ${days.from}, in the committed days 0 to ${lastDay(plan)}, but has no lesson`,
        ar: "وحدة تبدأ في أسبوعيك الأولين بلا درس",
      };
    }),
];

export function planViolations(plan: CoursePlan, limits: Limits): Violation[] {
  return RULES.flatMap((rule) => rule(plan, limits));
}

// A learner's edit as the plan's next version, if the plan still keeps every rule after it.
export function applyEdit(plan: CoursePlan, edit: PlanEdit, limits: Limits): EditResult {
  const refuse = (violation: Violation): EditResult => ({ ok: false, violations: [violation] });
  const session = plan.committed.sessions.find((s) => s.id === edit.session_id);
  if (!session) {
    return refuse({
      en: `the plan has no session ${edit.session_id}`,
      ar: "هذه الجلسة ليست في خطتك",
    });
  }
  if (edit.op === "shorten" && edit.minutes >= session.minutes) {
    return refuse({
      en: `session ${session.id}: ${edit.minutes} minutes is not shorter than ${session.minutes}`,
      ar: "المدة الجديدة ليست أقصر من مدة الجلسة الآن",
    });
  }
  const change = edit.op === "move" ? { day: edit.day } : { minutes: edit.minutes };
  const next: CoursePlan = {
    ...plan,
    committed: {
      ...plan.committed,
      sessions: plan.committed.sessions.map((s) => (s.id === session.id ? { ...s, ...change } : s)),
    },
    version: plan.version + 1,
    reason: "learner_edit",
  };
  const violations = planViolations(next, limits);
  return violations.length ? { ok: false, violations } : { ok: true, plan: next };
}
