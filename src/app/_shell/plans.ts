// Reading a plan's versions for the progress and plan pages (#21, #26): each day of the committed
// weeks marked from the sim clock, and what each version changed, in Arabic lines built from its
// diff: a few lines for the version, or one line per session with a tag per change.

import type { CoursePlan, PlanChange } from "../../../contracts/index.ts";
import { type Session, sessionsOf, simDay } from "./course.ts";
import {
  arabicNumber,
  CHANGES,
  type CountForms,
  countOf,
  MINUTES,
  MODULES,
  ordinal,
  ordinalF,
  SESSIONS,
  WEEKS,
} from "./format.ts";

// The app records quizzes, not sessions. A session counts as done once its lesson is passed, and as
// missed once its day is past with the lesson not passed: the re-planner's own test for a missed
// session. A review goes over a lesson already passed, so it stays due on its day.
export type SessionMark = "done" | "missed" | "due" | "upcoming";
export type DayMark = SessionMark | "rest";

// A day shows the first of its sessions' marks in this order; a day with none is a rest day.
const DAY_MARK_ORDER: readonly SessionMark[] = ["missed", "due", "upcoming", "done"];

export type PlanDay = {
  day: number;
  today: boolean;
  mark: DayMark;
  sessions: SessionMark[];
  minutes: number;
};

// "day10" is day 10.
export const startDay = (plan: CoursePlan): number =>
  Number(plan.committed.start.replace(/^day/, ""));

export function sessionMark(s: Session, passed: ReadonlySet<string>, today: number): SessionMark {
  if (s.day > today) return "upcoming";
  if (passed.has(s.lesson_id) && (s.kind === "study" || s.day < today)) return "done";
  return s.day < today ? "missed" : "due";
}

// Each day of the active version's committed weeks, from day 0. A day keeps the sessions of the
// version in force on it, the newest whose commitment had started, so a re-plan leaves the days
// before it as they were. `versions` is oldest first.
export function planDays(
  versions: CoursePlan[],
  passed: ReadonlySet<string>,
  today: number,
): PlanDay[] {
  const active = versions.at(-1);
  if (!active) return [];
  return Array.from({ length: active.committed.weeks * 7 }, (_, day) => {
    const plan = versions.findLast((v) => startDay(v) <= day) ?? active;
    const sessions = plan.committed.sessions.filter((s) => s.day === day);
    const marks = sessions.map((s) => sessionMark(s, passed, today));
    return {
      day,
      today: day === today,
      mark: DAY_MARK_ORDER.find((m) => marks.includes(m)) ?? "rest",
      sessions: marks,
      minutes: sessions.reduce((sum, s) => sum + s.minutes, 0),
    };
  });
}

type Op = PlanChange["op"];
type ChangeOf<K extends Op> = Extract<PlanChange, { op: K }>;

// What each kind of change says, in the order the page lists them: what the version adds, then the
// sessions it moved, shortened, switched or dropped, then the modules that grew. Each gets the
// version's changes of its kind, at least one.
const LINES: { [K in Op]: (changes: ChangeOf<K>[], plan: CoursePlan) => string[] } = {
  review: (changes, plan) =>
    changes.map((c) => {
      const title = plan.committed.lessons.find((l) => l.id === c.lesson)?.title_ar;
      const of = title ? ` لدرس «${title}»` : "";
      return `أُضيفت مراجعة${of} في ${simDay(c.day)}، مدتها ${countOf(c.minutes, MINUTES)}`;
    }),
  move: (changes) => {
    const [only] = changes;
    if (only && changes.length === 1) {
      return [`نُقلت جلسة واحدة من ${simDay(only.from)} إلى ${simDay(only.to)}`];
    }
    const days = changes.map((c) => c.to);
    const [first, last] = [Math.min(...days), Math.max(...days)];
    const to = first === last ? simDay(first) : `ما بين ${simDay(first)} و${simDay(last)}`;
    return [`نُقلت ${countOf(changes.length, SESSIONS)} إلى ${to}`];
  },
  shorten: (changes) => {
    const [only] = changes;
    if (only && changes.length === 1) {
      return [`قُصّرت جلسة واحدة من ${arabicNumber(only.from)} إلى ${countOf(only.to, MINUTES)}`];
    }
    const total = (end: "from" | "to") => changes.reduce((sum, c) => sum + c[end], 0);
    return [
      `قُصّرت ${countOf(changes.length, SESSIONS)}، ومجموعها الآن ${countOf(total("to"), MINUTES)} بدل ${arabicNumber(total("from"))}`,
    ];
  },
  switch: (changes) => [`انتقلت ${countOf(changes.length, SESSIONS)} إلى مصدر آخر`],
  drop: (changes) => [`حُذفت ${countOf(changes.length, SESSIONS)}`],
  extend: (changes) =>
    changes.map(
      (c) =>
        `صار للوحدة ${ordinalF(c.module)} ${countOf(c.to, WEEKS)}، وكان لها ${countOf(c.from, WEEKS)}`,
    ),
};
const LINE_ORDER: readonly Op[] = ["review", "move", "shorten", "switch", "drop", "extend"];

function linesOf<K extends Op>(op: K, plan: CoursePlan): string[] {
  const changes = plan.diff.filter((c): c is ChangeOf<K> => c.op === op);
  return changes.length ? LINES[op](changes, plan) : [];
}

// What a version changed from the one before it; nothing for v1.
export function changeLines(plan: CoursePlan): string[] {
  return LINE_ORDER.flatMap((op) => linesOf(op, plan));
}

// Why a version exists, after «النسخة ٢».
export const REASON_TEXT: Record<CoursePlan["reason"], string> = {
  initial: "خطتك الأولى",
  learner_edit: "عدّلتَها بنفسك",
  inactivity_d5: "بعد خمسة أيام بلا جلسة",
  shrink: "طلبتَ جلسات أقصر",
  switch: "طلبتَ مصدرًا آخر",
  comeback: "عند عودتك بعد غياب",
};

// Why a version exists, in a few words: the proposal's pill and the lede of the version in force.
export const REASON_LABEL: Record<CoursePlan["reason"], string> = {
  initial: "خطتك الأولى",
  learner_edit: "عدّلتَها بنفسك",
  inactivity_d5: "أسبوع أخف بعد غياب",
  shrink: "جلسات أقصر بطلبك",
  switch: "مصدر آخر بطلبك",
  comeback: "بعد عودتك",
};

// One line of a version's full list of changes, with the kinds of change it carries.
export type SessionChange = { text: string; tags: Op[] };

// What a session of the version before became: «صارت في اليوم ١٢، و١٥ دقيقة بدل ٢٥».
function sessionText(own: PlanChange[]): string {
  const parts: string[] = [];
  for (const c of own) {
    if (c.op === "move") parts.push(`في ${simDay(c.to)}`);
    if (c.op === "shorten") parts.push(`${countOf(c.to, MINUTES)} بدل ${arabicNumber(c.from)}`);
    if (c.op === "switch") parts.push("من مصدر آخر");
  }
  if (own.some((c) => c.op === "drop")) return " حُذفت";
  return parts.length ? ` صارت ${parts.join("، و")}` : "";
}

// Every change of `next` from `prev`, the version before it: the reviews it adds, then each session
// of `prev` it changed, in day order, then the modules that grew. Every change is one tag.
export function sessionChanges(prev: CoursePlan, next: CoursePlan): SessionChange[] {
  const lessons = next.committed.lessons;
  const nth = (id: string) => ordinal(lessons.findIndex((l) => l.id === id));
  const reviews = next.diff.flatMap((c) =>
    c.op === "review"
      ? [
          {
            text: `جلسة مراجعة جديدة للدرس ${nth(c.lesson)} في ${simDay(c.day)}، ${countOf(c.minutes, MINUTES)}`,
            tags: [c.op],
          },
        ]
      : [],
  );
  const sessions = sessionsOf(prev).flatMap((s) => {
    const own = next.diff.filter((c) => "session" in c && c.session === s.id && c.op !== "review");
    if (!own.length) return [];
    return [
      {
        text: `جلسة الدرس ${nth(s.lesson_id)} في ${simDay(s.day)}${sessionText(own)}`,
        tags: own.map((c) => c.op),
      },
    ];
  });
  const modules = next.diff.flatMap((c) =>
    c.op === "extend"
      ? [
          {
            text: `صارت الوحدة ${ordinalF(c.module)} ${countOf(c.to, WEEKS)} بدل ${countOf(c.from, WEEKS)}`,
            tags: [c.op],
          },
        ]
      : [],
  );
  return [...reviews, ...sessions, ...modules];
}

// A count of sessions after a verbal noun: «حذف جلسة»، «حذف جلستين»، «حذف ٣ جلسات».
const ofSessions = (noun: string) => (n: number) =>
  n === 1 ? `${noun} جلسة` : n === 2 ? `${noun} جلستين` : `${noun} ${countOf(n, SESSIONS)}`;
const counted = (forms: CountForms) => (n: number) => countOf(n, forms);

// How a count of each kind of change reads, in the order the list gives them.
const TALLY: { [K in Op]: (n: number) => string } = {
  review: counted({ one: "مراجعة واحدة", two: "مراجعتان", few: "مراجعات", many: "مراجعة" }),
  move: counted({ one: "نقل واحد", two: "نقلان", few: "نقلات", many: "نقلًا" }),
  shorten: counted({ one: "تقصير واحد", two: "تقصيران", few: "تقصيرات", many: "تقصيرًا" }),
  switch: ofSessions("تبديل مصدر"),
  drop: ofSessions("حذف"),
  extend: (n) =>
    n === 1 ? "تمديد وحدة" : n === 2 ? "تمديد وحدتين" : `تمديد ${countOf(n, MODULES)}`,
};

// «٢٤ تغييرًا: مراجعة واحدة، و١١ نقلًا، و١١ تقصيرًا، وتمديد وحدة».
export function changeTally(diff: PlanChange[]): string {
  const parts = LINE_ORDER.flatMap((op) => {
    const n = diff.filter((c) => c.op === op).length;
    return n ? [TALLY[op](n)] : [];
  });
  return `${countOf(diff.length, CHANGES)}: ${parts.join("، و")}`;
}
