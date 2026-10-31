// The re-planner (#26): when the learner comes back, code lays the lessons they have not passed
// again from today, as the plan's next version. The first week back is lighter than any week of
// the first version, a review of a lesson they half forgot comes first, and a lesson never starts
// before the one before it ends. Days still count from day 0 of the course: a module that needs
// more days grows, and the modules after it move back. Nothing here calls a model or reads a clock.

import { isDeepStrictEqual } from "node:util";
import type {
  CoursePlan,
  PlanChange,
  ReplanNote,
  ReplanReason,
  Resource,
} from "../../../../contracts/index.ts";
import { addressIn } from "../lesson/rules.ts";
import {
  type Limits,
  planViolations,
  SESSION_MINUTES,
  type Violation,
  weekMinutes,
} from "./rules.ts";

type Session = CoursePlan["committed"]["sessions"][number];

// What the re-planner knows of the learner's return: the day, the lessons they passed, why it
// re-plans, the lesson their recap says to review first, and the resource a switch moves to.
export type ReplanFacts = {
  today: number;
  passed: ReadonlySet<string>;
  reason: ReplanReason;
  review_lesson: string | null;
  switch_to: string | null;
};

// What the coach passes on when the learner comes back (#27): why it re-plans, the day, the days
// away, and the recap: whether it fell below the gate and the lesson to review first.
export type ReplanRequest = {
  reason: ReplanReason;
  today: number;
  away_days: number;
  recap: { below_gate: boolean; review_lesson: string | null } | null;
};

// `unchanged` when the plan already fits the learner's return; otherwise the broken rules.
export type ReplanResult =
  | { ok: true; plan: CoursePlan }
  | { ok: false; unchanged: boolean; why: Violation[] };

// The first week back takes at most 60% of the lightest week of the first version, and each of its
// sessions at most 20 minutes.
export const LIGHTER_SHARE = 0.6;
const LIGHT_SESSION_MINUTES = 20;
const REVIEW_MINUTES = 15;
// «جلسات أقصر»: 60% of a session's time, rounded down to 5 minutes, never under the minimum.
const SHRINK_SHARE = 0.6;
const shorter = (minutes: number) =>
  Math.max(SESSION_MINUTES.min, Math.floor((minutes * SHRINK_SHARE) / 5) * 5);
// A session that finds no room in this many tries is refused rather than placed.
const MAX_TRIES = 200;

// The minutes of the first version's lightest week with any session.
export const lightestWeek = (original: CoursePlan): number =>
  Math.min(...weekMinutes(original).filter((minutes) => minutes > 0));

export const lighterCap = (original: CoursePlan): number =>
  Math.floor(LIGHTER_SHARE * lightestWeek(original));

// Minutes of sessions on the seven days from `from`.
export const lighterWeek = (plan: CoursePlan, from: number): number =>
  plan.committed.sessions
    .filter((s) => s.day >= from && s.day < from + 7)
    .reduce((sum, s) => sum + s.minutes, 0);

// The day a module starts, with the modules' weeks as they are now.
const moduleStart = (weeks: number[], module: number) =>
  7 * weeks.slice(0, module).reduce((sum, w) => sum + w, 0);

const unchanged = (en: string, ar: string): ReplanResult => ({
  ok: false,
  unchanged: true,
  why: [{ en, ar }],
});

export function replan(
  active: CoursePlan,
  original: CoursePlan,
  limits: Limits,
  facts: ReplanFacts,
): ReplanResult {
  const { today, passed } = facts;
  const cap = lighterCap(original);
  const { lessons, sessions } = active.committed;
  const unpassed = lessons.filter((l) => !passed.has(l.id));
  const current = unpassed[0];
  if (!current) return unchanged("every lesson is passed", "اجتزتَ كل دروس خطتك");
  const shrink = facts.reason === "shrink";
  const missed = sessions.some((s) => !passed.has(s.lesson_id) && s.day < today);
  if (
    !missed &&
    !facts.review_lesson &&
    !shrink &&
    !facts.switch_to &&
    lighterWeek(active, today) <= cap
  ) {
    return unchanged(
      `nothing missed, and the week from day ${today} has ${lighterWeek(active, today)} of ${cap} minutes`,
      "خطتك تناسب عودتك كما هي",
    );
  }

  // Sessions of passed lessons before today stay as history; the ones after it go. A passed lesson
  // with no session left gets a review, so every lesson keeps one.
  const kept = sessions.filter((s) => passed.has(s.lesson_id) && s.day < today);
  const reviewed = [
    ...new Set([
      ...(facts.review_lesson ? [facts.review_lesson] : []),
      ...lessons
        .filter((l) => passed.has(l.id) && !kept.some((s) => s.lesson_id === l.id))
        .map((l) => l.id),
    ]),
  ];
  let lastId = Math.max(...sessions.map((s) => Number(s.id.slice(1))));
  const reviews: Session[] = reviewed.map((lesson_id) => ({
    id: `s${++lastId}`,
    day: today,
    minutes: REVIEW_MINUTES,
    lesson_id,
    resource_ids: [
      ...new Set(sessions.filter((s) => s.lesson_id === lesson_id).flatMap((s) => s.resource_ids)),
    ],
    kind: "review",
  }));
  const studies = unpassed.flatMap((l) =>
    sessions
      .filter((s) => s.lesson_id === l.id && s.kind === "study")
      .toSorted((a, b) => a.day - b.day)
      .map((s) => ({
        ...s,
        minutes: shrink ? shorter(s.minutes) : s.minutes,
        resource_ids: facts.switch_to && l.id === current.id ? [facts.switch_to] : s.resource_ids,
      })),
  );

  // Each session goes on the first day it fits, in order: not before its module starts, inside the
  // lighter week's cap, and inside the learner's weekly time. The lighter week keeps a day free
  // between sessions.
  const weeks = active.road.map((step) => step.weeks);
  const moduleOf = new Map(lessons.map((l) => [l.id, l.module]));
  const used = new Map<number, number>();
  const use = (day: number, minutes: number) => {
    const week = Math.floor(day / 7);
    used.set(week, (used.get(week) ?? 0) + minutes);
  };
  for (const s of kept) use(s.day, s.minutes);
  let light = 0;
  let cursor = today;
  const placed: Session[] = [];
  for (const s of [...reviews, ...studies]) {
    const module = moduleOf.get(s.lesson_id) ?? 0;
    let day = Math.max(cursor, s.kind === "review" ? today : moduleStart(weeks, module));
    let minutes = s.minutes;
    for (let tries = 0; ; tries++) {
      if (tries === MAX_TRIES) {
        return {
          ok: false,
          unchanged: false,
          why: [{ en: `no day has room for session ${s.id}`, ar: "لا يوم يتسع لإحدى جلساتك" }],
        };
      }
      const inLight = day < today + 7;
      minutes = inLight ? Math.min(s.minutes, LIGHT_SESSION_MINUTES) : s.minutes;
      if (inLight && light + minutes > cap) {
        day = today + 7;
        continue;
      }
      const week = Math.floor(day / 7);
      if ((used.get(week) ?? 0) + minutes > limits.budget_minutes) {
        day = (week + 1) * 7;
        continue;
      }
      break;
    }
    const inLight = day < today + 7;
    if (inLight) light += minutes;
    use(day, minutes);
    placed.push({ ...s, day, minutes });
    cursor = day + (inLight ? 2 : 1);
    if (s.kind === "study") {
      const from = moduleStart(weeks, module);
      weeks[module] = Math.max(weeks[module] ?? 0, Math.ceil((day + 1 - from) / 7));
    }
  }

  const laid = [...kept, ...placed].toSorted((a, b) => a.day - b.day);
  const lastDay = Math.max(...laid.map((s) => s.day));
  const next: CoursePlan = {
    ...active,
    road: active.road.map((step, i) => ({ ...step, weeks: weeks[i] ?? step.weeks })),
    committed: {
      ...active.committed,
      start: `day${today}`,
      weeks: Math.max(active.committed.weeks, Math.ceil((lastDay + 1) / 7)),
      sessions: laid,
    },
    version: active.version + 1,
    reason: facts.reason,
    diff: [],
    explanation_ar: null,
  };
  const plan = { ...next, diff: diffOf(active, next) };
  const why = [...planViolations(plan, limits), ...replanViolations(plan, active, facts, cap)];
  return why.length ? { ok: false, unchanged: false, why } : { ok: true, plan };
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

// What changed from one version to the next: the sessions it adds, which only a re-plan's reviews
// are, then each earlier session moved, shortened, switched or dropped, then the modules that grew.
export function diffOf(prev: CoursePlan, next: CoursePlan): PlanChange[] {
  const before = new Map(prev.committed.sessions.map((s) => [s.id, s]));
  const after = new Map(next.committed.sessions.map((s) => [s.id, s]));
  const added: PlanChange[] = next.committed.sessions
    .filter((s) => !before.has(s.id))
    .map((s) => ({
      op: "review",
      session: s.id,
      lesson: s.lesson_id,
      day: s.day,
      minutes: s.minutes,
    }));
  const changed = prev.committed.sessions.flatMap((was): PlanChange[] => {
    const now = after.get(was.id);
    if (!now) return [{ op: "drop", session: was.id }];
    return [
      ...(now.day === was.day
        ? []
        : [{ op: "move" as const, session: was.id, from: was.day, to: now.day }]),
      ...(now.minutes === was.minutes
        ? []
        : [{ op: "shorten" as const, session: was.id, from: was.minutes, to: now.minutes }]),
      ...(sameIds(now.resource_ids, was.resource_ids)
        ? []
        : [
            {
              op: "switch" as const,
              session: was.id,
              from: was.resource_ids,
              to: now.resource_ids,
            },
          ]),
    ];
  });
  const grown = prev.road.flatMap((step, module): PlanChange[] => {
    const weeks = next.road[module]?.weeks ?? step.weeks;
    return weeks === step.weeks ? [] : [{ op: "extend", module, from: step.weeks, to: weeks }];
  });
  return [...added, ...changed, ...grown];
}

// The rules a re-plan keeps beyond every plan's: the lighter week under the cap, nothing left
// before today, each lesson after the one before it, reviews first, and the same plan one version
// on, with its history as it was.
export function replanViolations(
  next: CoursePlan,
  prev: CoursePlan,
  facts: ReplanFacts,
  cap: number,
): Violation[] {
  const { today, passed } = facts;
  const { lessons, sessions } = next.committed;
  const problems: Violation[] = [];
  const light = lighterWeek(next, today);
  if (light > cap) {
    problems.push({
      en: `the week from day ${today} has ${light} minutes, over the cap of ${cap}`,
      ar: "أسبوعك الأول بعد العودة أثقل مما ينبغي",
    });
  }
  for (const s of sessions.filter((s) => !passed.has(s.lesson_id) && s.day < today)) {
    problems.push({
      en: `session ${s.id} of ${s.lesson_id} is on day ${s.day}, before day ${today}`,
      ar: "جلسة لدرس لم تجتزه بقيت في يوم مضى",
    });
  }
  const days = (lessonId: string) =>
    sessions.filter((s) => s.lesson_id === lessonId).map((s) => s.day);
  const unpassed = lessons.filter((l) => !passed.has(l.id));
  for (const [i, later] of unpassed.entries()) {
    const earlier = unpassed[i - 1];
    if (!earlier) continue;
    const ends = Math.max(...days(earlier.id));
    const starts = Math.min(...days(later.id));
    if (starts <= ends) {
      problems.push({
        en: `${later.id} starts on day ${starts}, before ${earlier.id} ends on day ${ends}`,
        ar: "درس يبدأ قبل أن ينتهي الدرس الذي قبله",
      });
    }
  }
  const studies = sessions.filter((s) => s.kind === "study" && s.day >= today);
  for (const r of sessions.filter((s) => s.kind === "review" && s.day >= today)) {
    if (studies.some((s) => s.day <= r.day)) {
      problems.push({
        en: `review ${r.id} on day ${r.day} comes after a study session`,
        ar: "المراجعة ليست أول ما في خطتك",
      });
    }
  }
  if (next.id !== prev.id || next.version !== prev.version + 1) {
    problems.push({
      en: `plan ${next.id} version ${next.version} is not ${prev.id} version ${prev.version + 1}`,
      ar: "النسخة الجديدة ليست التالية لخطتك",
    });
  }
  const now = new Map(sessions.map((s) => [s.id, s]));
  for (const was of prev.committed.sessions) {
    if (!passed.has(was.lesson_id) || was.day >= today) continue;
    if (!isDeepStrictEqual(now.get(was.id), was)) {
      problems.push({
        en: `session ${was.id} before day ${today} is not kept as it was`,
        ar: "تغيّرت جلسة مضت من خطتك",
      });
    }
  }
  return problems;
}

// What a switch can move the current lesson to: verified resources it does not use yet, best score
// first, an open licence before a personal-study one, then by id.
export function switchCandidates(
  plan: CoursePlan,
  resources: Resource[],
  lessonId: string,
): Resource[] {
  const own = new Set(
    plan.committed.sessions.filter((s) => s.lesson_id === lessonId).flatMap((s) => s.resource_ids),
  );
  const personal = (r: Resource) => (r.licence.use === "personal_study" ? 1 : 0);
  return resources
    .filter((r) => r.licence.verified && !own.has(r.id))
    .toSorted(
      (a, b) =>
        b.score - a.score || personal(a) - personal(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

// The lessons a version moves to other resources.
export function switchedLessons(plan: CoursePlan): CoursePlan["committed"]["lessons"] {
  const sessions = new Set(plan.diff.flatMap((c) => (c.op === "switch" ? [c.session] : [])));
  const lessons = new Set(
    plan.committed.sessions.filter((s) => sessions.has(s.id)).map((s) => s.lesson_id),
  );
  return plan.committed.lessons.filter((l) => lessons.has(l.id));
}

// What an explanation of a re-plan may say: the facts of the change, with lesson and module titles,
// the interview's notes and, for a switch the re-plan made, the resources the current lesson can
// move to. No name, learner id, topic or clock time. The recap is a band, never a score.
export type ReplanBrief = {
  reason: ReplanReason;
  away_days: number;
  recap: "low" | "good" | "none";
  review: { lesson_title_ar: string; day: number; minutes: number } | null;
  current_lesson_title_ar: string;
  lighter: {
    from_day: number;
    minutes: number;
    cap: number;
    original_week: number;
    percent: number;
  };
  missed: number;
  moved: number;
  shortened: number;
  switched: number;
  road_weeks: { before: number; after: number };
  // In weeks.
  grown: { module_ar: string; from: number; to: number }[];
  candidates: Pick<Resource, "id" | "title" | "lang" | "type" | "why_ar">[];
  history_notes: string;
};

type ReviewChange = Extract<PlanChange, { op: "review" }>;

export function replanBrief(
  prev: CoursePlan,
  next: CoursePlan,
  original: CoursePlan,
  request: ReplanRequest,
  passed: ReadonlySet<string>,
  { resources, history_notes }: { resources: Resource[]; history_notes: string },
): ReplanBrief {
  const { today, recap } = request;
  const { lessons } = next.committed;
  const title = (lessonId: string) => lessons.find((l) => l.id === lessonId)?.title_ar ?? "";
  const count = (op: PlanChange["op"]) => next.diff.filter((c) => c.op === op).length;
  const review = next.diff.find((c): c is ReviewChange => c.op === "review");
  const roadWeeks = (plan: CoursePlan) => plan.road.reduce((sum, step) => sum + step.weeks, 0);
  const current = lessons.find((l) => !passed.has(l.id))?.id ?? "";
  return {
    reason: request.reason,
    away_days: request.away_days,
    recap: recap === null ? "none" : recap.below_gate ? "low" : "good",
    review: review
      ? { lesson_title_ar: title(review.lesson), day: review.day, minutes: review.minutes }
      : null,
    current_lesson_title_ar: title(current),
    lighter: {
      from_day: today,
      minutes: lighterWeek(next, today),
      cap: lighterCap(original),
      original_week: lightestWeek(original),
      percent: LIGHTER_SHARE * 100,
    },
    missed: prev.committed.sessions.filter((s) => !passed.has(s.lesson_id) && s.day < today).length,
    moved: count("move"),
    shortened: count("shorten"),
    switched: count("switch"),
    road_weeks: { before: roadWeeks(prev), after: roadWeeks(next) },
    grown: next.diff.flatMap((c) =>
      c.op === "extend"
        ? [{ module_ar: next.road[c.module]?.module ?? "", from: c.from, to: c.to }]
        : [],
    ),
    candidates: count("switch")
      ? switchCandidates(prev, resources, current).map(({ id, title, lang, type, why_ar }) => ({
          id,
          title,
          lang,
          type,
          why_ar,
        }))
      : [],
    history_notes,
  };
}

export const MAX_NOTE = 400;

// The numbers in a text, written in Latin or Arabic-Indic digits. Both Arabic-Indic sets start at a
// code point divisible by 16, so a digit's code point mod 16 is its value.
const numbersIn = (text: string) =>
  [...text.matchAll(/[0-9\u0660-\u0669\u06f0-\u06f9]+/g)].map(([run]) =>
    Number(run.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) % 16))),
  );

// Why a note cannot explain the re-plan to the learner. A number counts as the brief's when its
// facts, titles or notes give it; a resource id or the reason's name does not.
export function noteViolations(note: ReplanNote, brief: ReplanBrief): string[] {
  const text = note.explanation_ar;
  const problems: string[] = [];
  if (!/\p{Script=Arabic}/u.test(text)) problems.push("the explanation has no Arabic text");
  if (text.length > MAX_NOTE) {
    problems.push(`the explanation has ${text.length} characters; at most ${MAX_NOTE}`);
  }
  if (addressIn(text)) problems.push("the explanation has a web address or email");
  if (/[{}]/.test(text)) problems.push("the explanation has braces");
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push("the explanation has an emoji");
  const { reason: _, candidates, ...facts } = brief;
  const given = new Set(
    numbersIn(JSON.stringify([facts, candidates.map(({ id: __, ...c }) => c)])),
  );
  const invented = [...new Set(numbersIn(text))].filter((n) => !given.has(n));
  if (invented.length) {
    problems.push(`the explanation says ${invented.join(", ")}, which the brief does not give`);
  }
  const ids = candidates.map((c) => c.id);
  if (note.resource_id !== null && !ids.includes(note.resource_id)) {
    problems.push(
      ids.length
        ? `resource_id ${note.resource_id} is not one of the candidates`
        : "resource_id must be null: the brief offers no switch",
    );
  }
  return problems;
}

const arabicNumber = (n: number) => n.toLocaleString("ar-EG");
const dayAr = (day: number) => (day === 0 ? "يوم البدء" : `اليوم ${arabicNumber(day)}`);
const minutesAr = (n: number) => `${arabicNumber(n)} ${n >= 3 && n <= 10 ? "دقائق" : "دقيقة"}`;
// Weeks after «صار»: «أسبوعين», «١٠ أسابيع», «١٢ أسبوعًا».
const weeksAr = (n: number) =>
  n === 2 ? "أسبوعين" : `${arabicNumber(n)} ${n >= 3 && n <= 10 ? "أسابيع" : "أسبوعًا"}`;

// The explanation in code's words, from the brief alone. It names only what the re-plan did, so a
// switch with no new resource reads as any other return.
export function templateNote(brief: ReplanBrief): string {
  const { lighter, review, road_weeks: road } = brief;
  const from = dayAr(lighter.from_day);
  const opening =
    brief.reason === "shrink" && brief.shortened > 0
      ? `طلبتَ جلسات أقصر، فرتّبنا خطتك من ${from} بجلسات أقصر.`
      : brief.reason === "switch" && brief.switched > 0
        ? `طلبتَ مصدرًا آخر، فرتّبنا خطتك من ${from} بمصدر بديل لدرس «${brief.current_lesson_title_ar}».`
        : `رتّبنا خطتك من ${from} لتناسب عودتك.`;
  return [
    opening,
    ...(review ? [`تبدأ بمراجعة قصيرة لدرس «${review.lesson_title_ar}».`] : []),
    `أسبوعك الأول أخف: ${minutesAr(lighter.minutes)}، والحد ${minutesAr(lighter.cap)}.`,
    ...(road.after > road.before
      ? [`وصار طريقك ${weeksAr(road.after)} بدل ${arabicNumber(road.before)}.`]
      : []),
  ].join(" ");
}

// The trace's account of a re-plan: the lighter week against its cap, then each kind of change.
export function replanSummary(plan: CoursePlan, brief: ReplanBrief): { ar: string; en: string } {
  const { lighter } = brief;
  const dropped = plan.diff.filter((c) => c.op === "drop").length;
  const en = [
    `lighter week ${lighter.minutes}/${lighter.cap} (${lighter.percent}% of ${lighter.original_week})`,
    `${brief.missed} missed`,
    `${brief.moved} moved`,
    `${brief.shortened} shortened`,
    ...(brief.switched ? [`${brief.switched} switched`] : []),
    ...(dropped ? [`${dropped} dropped`] : []),
    ...plan.diff.flatMap((c) => {
      if (c.op === "review") return [`review ${c.lesson} day ${c.day}`];
      if (c.op === "extend") return [`module ${c.module} ${c.from}->${c.to} weeks`];
      return [];
    }),
  ].join(", ");
  return {
    ar: `رتّب مُعيد التخطيط خطتك من ${dayAr(lighter.from_day)}، وأسبوعك الأخف ${minutesAr(lighter.minutes)} والحد ${minutesAr(lighter.cap)}`,
    en: `v${plan.version} (${plan.reason}): ${en}`,
  };
}
