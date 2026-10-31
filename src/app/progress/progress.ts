// The progress view's reading of the plan (#21): each day of the committed weeks marked from the
// sim clock, and what each plan version changed, in a few Arabic lines built from its diff.

import type { CoursePlan, PlanChange } from "../../../contracts/index.ts";
import { type Session, simDay } from "../_shell/course.ts";
import { arabicNumber, countOf, MINUTES, ordinalF, SESSIONS, WEEKS } from "../_shell/format.ts";

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

function sessionMark(s: Session, passed: ReadonlySet<string>, today: number): SessionMark {
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
