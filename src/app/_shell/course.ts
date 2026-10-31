// Reading the course out of a seeded session for the route pages (#15): the latest plan, its
// modules by week, where a lesson sits in them, and the course, quiz and coach states every page
// shows the same way. Display helpers only; no plan logic.

import type {
  CoachEvent,
  CoursePlan,
  Lesson,
  Quiz,
  QuizAttempt,
} from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import { hhmm, type SimTime } from "../../server/clock/time.ts";
import { arabicNumber, clockTime, countOf, MODULES, ordinalF } from "./format.ts";
import type { Status } from "./ui.tsx";

export type Session = CoursePlan["committed"]["sessions"][number];

export type CourseModule = {
  index: number;
  title: string;
  weeks: number;
  // Simulated days [fromDay, toDay) the module covers.
  fromDay: number;
  toDay: number;
};

// A state as a status pill shows it.
export type Shown = { status: Status; label: string };

export const unique = <T>(values: T[]) => [...new Set(values)];

// The newest version: a re-plan is a new version, never an edit (ADR-006).
export function latestPlan(seed: Seed): CoursePlan | undefined {
  return seed.plans.reduce<CoursePlan | undefined>(
    (latest, plan) => (!latest || plan.version > latest.version ? plan : latest),
    undefined,
  );
}

export function modulesOf(plan: CoursePlan): CourseModule[] {
  let start = 0;
  return plan.road.map((step, index) => {
    const fromDay = start;
    start += step.weeks * 7;
    return { index, title: step.module, weeks: step.weeks, fromDay, toDay: start };
  });
}

export function sessionsOf(plan: CoursePlan): Session[] {
  return [...plan.committed.sessions].sort((a, b) => a.day - b.day);
}

export function inModule(module: CourseModule, day: number): boolean {
  return day >= module.fromDay && day < module.toDay;
}

// The lessons a module holds: the ones its committed sessions teach.
export function moduleLessons(seed: Seed, plan: CoursePlan, module: CourseModule): Lesson[] {
  const ids = new Set(
    sessionsOf(plan)
      .filter((s) => inModule(module, s.day))
      .map((s) => s.lesson_id),
  );
  return seed.lessons.filter((l) => ids.has(l.id));
}

// A lesson's first session, and the module whose weeks hold it.
export function lessonPlace(
  plan: CoursePlan,
  lessonId: string,
): { session: Session | undefined; module: CourseModule | undefined } {
  const session = sessionsOf(plan).find((s) => s.lesson_id === lessonId);
  const module = session ? modulesOf(plan).find((m) => inModule(m, session.day)) : undefined;
  return { session, module };
}

// How much of the course is written. A module is ready once it has lessons, so while later
// modules still wait the status names the ready one («الوحدة الأولى جاهزة»), not the course.
export function courseStatus(seed: Seed): Shown {
  const plan = latestPlan(seed);
  const modules = plan ? modulesOf(plan) : [];
  const ready = plan ? modules.filter((m) => moduleLessons(seed, plan, m).length > 0) : [];
  const [only] = ready;
  if (!only) return { status: "waiting", label: "لم تجهز أي وحدة بعد" };
  if (ready.length === modules.length) return { status: "ready", label: "دورتك جاهزة" };
  if (ready.length === 1) return { status: "ready", label: `الوحدة ${ordinalF(only.index)} جاهزة` };
  return {
    status: "ready",
    label: `جهزت ${countOf(ready.length, MODULES)} من ${arabicNumber(modules.length)}`,
  };
}

export type QuizState = Shown & {
  quiz: Quiz;
  gate: number;
  // Oldest first.
  attempts: QuizAttempt[];
  tries: number;
  // Best score so far; undefined until the first attempt.
  best: number | undefined;
  passed: boolean;
};

// A lesson's quiz as every page shows it, from the quiz, its attempts and the lesson's mastery: not
// tried yet, passed, or below the gate («أعد المحاولة»).
export function quizState(seed: Seed, lessonId: string): QuizState | undefined {
  const quiz = seed.quizzes.find((q) => q.lesson_id === lessonId);
  if (!quiz) return undefined;
  const attempts = seed.attempts
    .filter((a) => a.quiz_id === quiz.id)
    .sort((a, b) => a.sim_day - b.sim_day);
  const mastery = seed.mastery.find((m) => m.lesson_id === lessonId);
  const tries = Math.max(mastery?.attempts ?? 0, attempts.length);
  const base = { quiz, gate: quiz.pass_threshold, attempts, tries };
  if (tries === 0) {
    return { ...base, best: undefined, passed: false, status: "waiting", label: "لم تختبر بعد" };
  }
  const best = Math.max(mastery?.best_score ?? 0, ...attempts.map((a) => a.score));
  const passed = mastery?.passed === true || attempts.some((a) => a.passed);
  return passed
    ? { ...base, best, passed, status: "ready", label: "اجتزته" }
    : { ...base, best, passed, status: "attention", label: "أعد المحاولة" };
}

// A simulated day by name. Day 0 is the day the course starts: «يوم البدء», because «اليوم ٠»
// with an Arabic-Indic zero reads as a dot.
export function simDay(day: number): string {
  return day === 0 ? "يوم البدء" : `اليوم ${arabicNumber(day)}`;
}

// A simulated time in full, e.g. «اليوم ٢، ٧:٠٠ م».
export function simTimeText(t: SimTime): string {
  return `${simDay(t.day)}، ${clockTime(hhmm(t.minute))}`;
}

export const COACH_TITLE: Record<CoachEvent["type"], string> = {
  nudge: "تذكير من المدرب",
  replan: "خطة معدّلة من المدرب",
  checkin: "سؤال من المدرب",
  weekly: "ملخص الأسبوع",
  comeback: "رسالة للعودة",
};

export const COACH_STATUS: Record<CoachEvent["status"], Shown> = {
  queued: { status: "waiting", label: "مجدولة" },
  sent: { status: "ready", label: "أُرسلت" },
  suppressed_quiet_hours: { status: "attention", label: "أُجّلت لساعات الهدوء" },
  suppressed_opt_out: { status: "neutral", label: "أُوقفت بطلبك" },
};
