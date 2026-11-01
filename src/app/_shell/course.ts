// Reading the course out of a seeded session for the route pages (#15): the latest plan, its
// modules by week, where a lesson sits in them, and the course, quiz and coach states every page
// shows the same way. Display helpers only; no plan logic.

import type {
  CoachEvent,
  Consent,
  CoursePlan,
  Lesson,
  Quiz,
  QuizAttempt,
} from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import {
  compareSimTime,
  hhmm,
  parseSimTime,
  type SimTime,
  startOfDay,
} from "../../server/clock/time.ts";
import type { Ladder, LadderState } from "../../server/coach/ladder.ts";
import type { InboxEntry } from "../../server/notifier/adapters.ts";
import type { MessageKind } from "../../server/notifier/gate.ts";
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
  replan: "عرض أسبوع أخف",
  checkin: "سؤال من المدرب",
  weekly: "رسالة الأسبوع",
  comeback: "رسالة للعودة",
};

// The learner's consent to coach messages (#57) as every page names it: never asked, on, or stopped
// by the learner (the switch on /consent or «توقف»). The stored consent has no flag for "not asked":
// a learner who has neither agreed nor stopped was never asked, and nothing of theirs is stopped.
export type ConsentState = "not_asked" | "on" | "stopped";

export function consentState({
  granted,
  opted_out,
}: Pick<Consent, "granted" | "opted_out">): ConsentState {
  if (opted_out) return "stopped";
  return granted ? "on" : "not_asked";
}

export const CONSENT_PILL: Record<ConsentState, Shown> = {
  not_asked: { status: "neutral", label: "لم تُطلب موافقتك بعد" },
  on: { status: "ready", label: "الرسائل مفعّلة" },
  stopped: { status: "neutral", label: "الرسائل متوقفة بطلبك" },
};

// Before the intake the pages show the seed's consent, which is not the visitor's.
export const SAMPLE_PILL: Shown = { status: "neutral", label: "مثال" };

// The consent in one sentence: what reaches the learner, and since when. «بموافقتك» and «بطلبك» keep
// it in the second person, where a bare «وافقت» or «أوقفت» also reads as «I». Before the intake the
// consent is the sample learner's, so the sentence names them instead (`sample`).
export function consentText(consent: Consent, sample?: string): string {
  switch (consentState(consent)) {
    case "not_asked":
      return sample
        ? `لا تصل ${sample} أي رسالة من المدرب قبل أن يوافق عليها.`
        : "لا تصلك أي رسالة من المدرب قبل أن توافق عليها.";
    case "on":
      return `الرسائل مفعّلة ${sample ? `بموافقة ${sample}` : "بموافقتك"} منذ ${simDay(consent.granted_sim_day ?? 0)}، وتكفي كلمة «توقف» لإيقافها في أي وقت.`;
    case "stopped": {
      const since = simDay(consent.opted_out_sim_day ?? 0);
      return sample
        ? `الرسائل متوقفة بطلب ${sample} منذ ${since}، فلا يصله شيء حتى يعيد تفعيلها.`
        : `الرسائل متوقفة بطلبك منذ ${since}، فلا يصلك شيء حتى تعيد تفعيلها.`;
    }
  }
}

const CONFIRMATION: MessageKind = "opt_out_confirmation";

// When the learner stopped the messages, or null while they are not stopped. A «توقف» on the phone
// leaves the notifier's confirmation on the phone at its minute. The consent screen sends none and
// the consent keeps only the day, so a stop saved there counts from the start of that day.
export function stoppedAt(consent: Consent, inbox: readonly InboxEntry[]): SimTime | null {
  if (!consent.opted_out) return null;
  const day = consent.opted_out_sim_day ?? 0;
  const confirmed = inbox.findLast((e) => e.template === CONFIRMATION);
  const at = confirmed && parseSimTime(confirmed.sim_ts);
  return at && at.day === day ? at : { day, minute: 0 };
}

export type HeldReason = "not_agreed" | "stopped";

// Why the gate held back the coach message it fired at `at`: the learner had not agreed yet, or had
// stopped the messages (`stopped`, from stoppedAt()). The outbox keeps one status for both. A move
// fires every message due before the learner can act, so one fired at the minute of the stop came
// before it. Consent keeps only the day it was granted, so a message held that day came before it.
export function heldBecause(consent: Consent, at: SimTime, stopped: SimTime | null): HeldReason {
  if (stopped && compareSimTime(at, stopped) > 0) return "stopped";
  if (consent.granted_sim_day === null || at.day <= consent.granted_sim_day) return "not_agreed";
  return "stopped";
}

// Where the coach's ladder stands (#25), after «المدرب».
const LADDER_STATE: Record<Exclude<LadderState, "opted_out">, string> = {
  active: "يتابع دراستك",
  nudged_d2: "أرسل تذكير اليوم الثاني",
  replan_offered_d5: "عرض عليك أسبوعًا أخف",
  checkin_d10: "سألك عمّا يناسبك",
  weekly: "يرسل رسالة واحدة كل أسبوع",
  paused: "في استراحة طلبتها",
};

// The coach page's line on the ladder: its state, then when the pause ends or the next message is
// due. With the messages off, why: the learner has not agreed yet, or stopped them.
export function ladderText({ state, next, paused_until }: Ladder, consent: ConsentState): string {
  if (state === "opted_out") {
    return consent === "not_asked"
      ? "المدرب لا يرسل شيئًا قبل موافقتك."
      : "المدرب لا يرسل رسائل، فهي متوقفة بطلبك.";
  }
  const now = `المدرب ${LADDER_STATE[state]}`;
  if (paused_until) return `${now} حتى ${simTimeText(paused_until)}.`;
  return next ? `${now}. رسالته التالية في ${simDay(next.at.day)}.` : `${now}.`;
}

export const COACH_STATUS: Record<CoachEvent["status"], Shown> = {
  queued: { status: "waiting", label: "مجدولة" },
  sent: { status: "ready", label: "أُرسلت" },
  suppressed_quiet_hours: { status: "attention", label: "أُجّلت لساعات الهدوء" },
  suppressed_opt_out: { status: "neutral", label: "أُوقفت بطلبك" },
};

// A coach event's pill. A message held back before the learner agreed was not stopped by them. The
// coach fires each message at the start of its day (ladder.ts).
export function coachEventStatus(
  event: Pick<CoachEvent, "status" | "sim_day">,
  consent: Consent,
  stopped: SimTime | null,
): Shown {
  if (
    event.status === "suppressed_opt_out" &&
    heldBecause(consent, startOfDay(event.sim_day), stopped) === "not_agreed"
  )
    return { status: "neutral", label: "لم تُرسل قبل موافقتك" };
  return COACH_STATUS[event.status];
}
