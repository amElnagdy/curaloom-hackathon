// The plan in force beside the re-planner's proposal (#26, #27), as the comeback on the plan page
// draws it: each day's sessions in both versions, the sessions the proposal moves from one day to
// another, its lighter week, and the few numbers that sum it up. The comeback card draws the plan
// in force alone, with the sessions the learner missed.

import type { CoursePlan, PlanChange } from "../../../contracts/index.ts";
import { simDay } from "../_shell/course.ts";
import {
  arabicNumber,
  countOf,
  MINUTES,
  MODULES,
  ordinalF,
  SESSIONS,
  WEEKS,
} from "../_shell/format.ts";
import { sessionMark, startDay } from "../_shell/plans.ts";

export type BarState = "done" | "missed" | "plan" | "review";

export type TimelineDay = {
  day: number;
  // Every session of the day, summed; 0 on a rest day, whose state is null.
  minutes: number;
  state: BarState | null;
  // Past the version's committed weeks: the version had no plan for the day.
  out: boolean;
  // In the proposal's lighter week.
  band: boolean;
};
export type TimelineRow = { version: number; days: TimelineDay[] };
// A week's minutes in the plan in force and in the proposal; `before` is null for a week the plan in
// force does not commit to, `after` is null with no proposal.
export type TimelineWeek = { before: number | null; after: number | null };
export type Move = { session: string; from: number; to: number; missed: boolean };

export type Timeline = {
  days: number;
  today: number;
  weeks: TimelineWeek[];
  // The plan in force, then the proposal if there is one.
  rows: TimelineRow[];
  moves: Move[];
  band: { from: number; to: number } | null;
};

// A day with sessions of several states shows the first of them in this order.
const STATE_ORDER: readonly BarState[] = ["missed", "review", "plan", "done"];

const committedDays = (plan: CoursePlan) => plan.committed.weeks * 7;

function barState(
  s: CoursePlan["committed"]["sessions"][number],
  passed: ReadonlySet<string>,
  today: number,
): BarState {
  const mark = sessionMark(s, passed, today);
  if (mark === "done" || mark === "missed") return mark;
  return s.kind === "review" ? "review" : "plan";
}

function row(
  plan: CoursePlan,
  days: number,
  passed: ReadonlySet<string>,
  today: number,
  band: Timeline["band"],
): TimelineRow {
  return {
    version: plan.version,
    days: Array.from({ length: days }, (_, day) => {
      const own = plan.committed.sessions.filter((s) => s.day === day);
      const states = own.map((s) => barState(s, passed, today));
      return {
        day,
        minutes: own.reduce((sum, s) => sum + s.minutes, 0),
        state: STATE_ORDER.find((state) => states.includes(state)) ?? null,
        out: day >= committedDays(plan),
        band: band !== null && day >= band.from && day <= band.to,
      };
    }),
  };
}

const weekOf = (r: TimelineRow, week: number) =>
  r.days.slice(week * 7, week * 7 + 7).reduce((sum, d) => sum + d.minutes, 0);

// The plan in force day by day over its committed weeks, or over the longer of the two commitments
// with the proposal under it.
export function timeline(
  current: CoursePlan,
  passed: ReadonlySet<string>,
  today: number,
  proposed?: CoursePlan,
): Timeline {
  const days = Math.max(committedDays(current), proposed ? committedDays(proposed) : 0);
  const from = proposed && startDay(proposed);
  const band = from === undefined ? null : { from, to: from + 6 };
  const before = row(current, days, passed, today, null);
  const after = proposed && row(proposed, days, passed, today, band);
  const missed = new Set(
    current.committed.sessions
      .filter((s) => sessionMark(s, passed, today) === "missed")
      .map((s) => s.id),
  );
  return {
    days,
    today,
    weeks: Array.from({ length: days / 7 }, (_, week) => ({
      before: week < current.committed.weeks ? weekOf(before, week) : null,
      after: after ? weekOf(after, week) : null,
    })),
    rows: after ? [before, after] : [before],
    moves: (proposed?.diff ?? []).flatMap((c) =>
      c.op === "move"
        ? [{ session: c.session, from: c.from, to: c.to, missed: missed.has(c.session) }]
        : [],
    ),
    band,
  };
}

// The sessions of the plan in force the learner missed, and the first and last of their days.
export function missedSessions(
  plan: CoursePlan,
  passed: ReadonlySet<string>,
  today: number,
): { count: number; from: number; to: number } | null {
  const days = plan.committed.sessions
    .filter((s) => sessionMark(s, passed, today) === "missed")
    .map((s) => s.day);
  if (!days.length) return null;
  return { count: days.length, from: Math.min(...days), to: Math.max(...days) };
}

// A number set large, and what it counts.
export type Stat = { value: string; label: string };

// «جلسة» as a count beside its number shown apart, and a verb agreeing with it: a dual takes its
// own form, any other count a feminine singular.
const SESSIONS_NOUN = { ...SESSIONS, one: "جلسة" };
const sessionsNoun = (n: number) => countOf(n, SESSIONS_NOUN).replace(/^[٠-٩]+ /, "");
const agree = (n: number, one: string, two: string) => (n === 2 ? two : one);

type ChangeOf<K extends PlanChange["op"]> = Extract<PlanChange, { op: K }>;
const ofKind = <K extends PlanChange["op"]>(plan: CoursePlan, op: K) =>
  plan.diff.filter((c): c is ChangeOf<K> => c.op === op);

// «١٥ أو ١٠ دقائق»: the lengths, longest first, the last counted.
function lengths(minutes: number[]): string {
  const all = [...new Set(minutes)].sort((a, b) => b - a);
  const last = all.at(-1) ?? 0;
  const rest = all.slice(0, -1).map(arabicNumber);
  return [...rest, countOf(last, MINUTES)].join(rest.length > 1 ? "، أو " : " أو ");
}

// The proposal in a few numbers: the missed sessions it moves past today and the ones after them,
// the sessions it shortens, the road it makes longer, the sources it switches and the sessions it
// drops, each only when the proposal does it.
export function proposalStats(
  current: CoursePlan,
  proposed: CoursePlan,
  passed: ReadonlySet<string>,
  today: number,
): Stat[] {
  const stats: Stat[] = [];
  const { moves } = timeline(current, passed, today, proposed);
  const missed = moves.filter((m) => m.missed).length;
  const later = moves.length - missed;
  if (missed) {
    const after = later ? `، ومعها ${countOf(later, SESSIONS)} بعدها` : "";
    stats.push({
      value: arabicNumber(missed),
      label: `${sessionsNoun(missed)} ${agree(missed, "فاتتك نُقلت", "فاتتاك نُقلتا")} إلى ما بعد ${simDay(today)}${after}`,
    });
  } else if (later) {
    stats.push({
      value: arabicNumber(later),
      label: `${sessionsNoun(later)} ${agree(later, "نُقلت", "نُقلتا")} إلى أيام أخرى`,
    });
  }
  const shortened = ofKind(proposed, "shorten");
  if (shortened.length) {
    const n = shortened.length;
    stats.push({
      value: arabicNumber(n),
      label: `${sessionsNoun(n)} ${agree(n, "صارت", "صارتا")} أقصر: ${lengths(shortened.map((c) => c.to))}`,
    });
  }
  const extended = ofKind(proposed, "extend");
  const [only] = extended;
  if (only) {
    const weeks = (plan: CoursePlan) => plan.road.reduce((sum, m) => sum + m.weeks, 0);
    const why =
      extended.length === 1
        ? `الوحدة ${ordinalF(only.module)} صارت ${countOf(only.to, WEEKS)}`
        : `${extended.length === 2 ? "وحدتين" : countOf(extended.length, MODULES)} صارت أطول`;
    stats.push({
      value: countOf(weeks(proposed), WEEKS),
      label: `الطريق بدل ${arabicNumber(weeks(current))}، لأن ${why}`,
    });
  }
  const switched = ofKind(proposed, "switch").length;
  if (switched) {
    stats.push({
      value: arabicNumber(switched),
      label: `${sessionsNoun(switched)} ${agree(switched, "انتقلت", "انتقلتا")} إلى مصدر آخر`,
    });
  }
  const dropped = ofKind(proposed, "drop").length;
  if (dropped) {
    stats.push({
      value: arabicNumber(dropped),
      label: `${sessionsNoun(dropped)} ${agree(dropped, "حُذفت", "حُذفتا")} من خطتك`,
    });
  }
  return stats;
}
