// The coach's escalation ladder (#25), pure. From the day of the learner's last quiz (the anchor),
// a pause the learner chose and whether messages are on, it lists the rungs due by a time and says where the
// ladder stands. Nothing is stored: a quiz moves the anchor, which starts a new set of rung ids, so
// any activity returns the ladder to `active`.

import type { CheckinChoice, CoachEvent, ReplanReason } from "../../../contracts/index.ts";
import { compareSimTime, type SimTime, startOfDay } from "../clock/time.ts";

export const LADDER_STATES = [
  "active",
  "nudged_d2",
  "replan_offered_d5",
  "checkin_d10",
  "weekly",
  "paused",
  "opted_out",
] as const;
export type LadderState = (typeof LADDER_STATES)[number];

export const WEEK = 7;

// Each rung falls due at 09:00 of the day `after` days past the anchor; the weekly one then comes
// every WEEK days, so weekly messages are a week apart by construction.
export const RUNGS = [
  { kind: "d2", after: 2, type: "nudge", state: "nudged_d2" },
  { kind: "d5", after: 5, type: "replan", state: "replan_offered_d5" },
  { kind: "d10", after: 10, type: "checkin", state: "checkin_d10" },
  { kind: "weekly", after: 17, type: "weekly", state: "weekly" },
] as const satisfies readonly {
  kind: string;
  after: number;
  type: CoachEvent["type"];
  state: LadderState;
}[];
type Step = (typeof RUNGS)[number];
export type RungKind = Step["kind"];

export type Rung = {
  // Both the scheduler's ledger key and the coach event's id.
  id: string;
  kind: RungKind;
  type: CoachEvent["type"];
  state: LadderState;
  at: SimTime;
  inactive_days: number;
};
// No coach messages in [from, until). It belongs to the anchor it was chosen at, so activity ends it.
export type Pause = { anchor: number; from: SimTime; until: SimTime };
export type LadderFacts = { anchor: number; pause: Pause | null; messages_on: boolean };
export type Ladder = {
  state: LadderState;
  anchor: number;
  inactive_days: number;
  next: Rung | null;
  paused_until: SimTime | null;
};

// Day 0 counts as activity, so a learner who has not taken a quiz is chased from the course start.
export const anchorOf = (attemptDays: readonly number[]) => Math.max(0, ...attemptDays);

export const rungId = (type: CoachEvent["type"], anchor: number, day: number) =>
  `${type}_a${anchor}_d${day}`;

const firstOf = (kind: RungKind, anchor: number) => {
  const step = RUNGS.find((s) => s.kind === kind) as Step;
  return rungId(step.type, anchor, anchor + step.after);
};

// The check-in of the ladder from `anchor`: the one message the learner answers with a choice.
export const checkinOf = (anchor: number) => firstOf("d10", anchor);

// Two days away or more is a comeback (#27): a recap, then a re-plan. Only a learner with a plan of
// their own has one to re-plan.
export const COMEBACK_DAYS = 2;

export const comebackDue = (anchor: number, now: SimTime, ownPlan: boolean) =>
  ownPlan && now.day - anchor >= COMEBACK_DAYS;

// Why a comeback re-plans: what the learner asked at this ladder's check-in, else the day-5 offer of
// a lighter week if it reached them, else their return alone.
export function replanReason(
  anchor: number,
  replies: readonly { choice: CheckinChoice; anchor: number }[],
  sentIds: ReadonlySet<string>,
): ReplanReason {
  const asked = replies.findLast(
    (r): r is { choice: Exclude<CheckinChoice, "pause">; anchor: number } =>
      r.anchor === anchor && r.choice !== "pause",
  );
  if (asked) return asked.choice;
  return sentIds.has(firstOf("d5", anchor)) ? "inactivity_d5" : "comeback";
}

// A pause of `days` days from `from`, ending at the start of a day like the rungs it holds.
export const pauseFor = (anchor: number, from: SimTime, days: number): Pause => ({
  anchor,
  from,
  until: startOfDay(from.day + days),
});

const holds = ({ anchor, pause }: Pick<LadderFacts, "anchor" | "pause">, t: SimTime) =>
  pause !== null &&
  pause.anchor === anchor &&
  compareSimTime(pause.from, t) <= 0 &&
  compareSimTime(t, pause.until) < 0;

const rungOf = (step: Step, anchor: number, day: number): Rung => ({
  id: rungId(step.type, anchor, day),
  kind: step.kind,
  type: step.type,
  state: step.state,
  at: startOfDay(day),
  inactive_days: day - anchor,
});

// Every rung from the anchor, in time order, without end.
function* rungsFrom(anchor: number): Generator<Rung> {
  const weekly = RUNGS[RUNGS.length - 1] as Step;
  for (const step of RUNGS) {
    if (step !== weekly) yield rungOf(step, anchor, anchor + step.after);
  }
  for (let day = anchor + weekly.after; ; day += WEEK) yield rungOf(weekly, anchor, day);
}

// The rungs due by `upTo`, oldest first. A rung inside the pause is left out, so it never fires.
export function rungsThrough(f: Pick<LadderFacts, "anchor" | "pause">, upTo: SimTime): Rung[] {
  const due: Rung[] = [];
  for (const rung of rungsFrom(f.anchor)) {
    if (compareSimTime(rung.at, upTo) > 0) return due;
    if (!holds(f, rung.at)) due.push(rung);
  }
  return due;
}

// The first rule that applies decides: messages off, then a pause covering now, then the last rung
// reached, counting those the pause held.
export function ladderAt(f: LadderFacts, now: SimTime): Ladder {
  let reached: Rung | undefined;
  let next: Rung | null = null;
  for (const rung of rungsFrom(f.anchor)) {
    if (compareSimTime(rung.at, now) <= 0) reached = rung;
    else if (!holds(f, rung.at)) {
      next = rung;
      break;
    }
  }
  const paused = holds(f, now) ? f.pause : null;
  return {
    state: !f.messages_on ? "opted_out" : paused ? "paused" : (reached?.state ?? "active"),
    anchor: f.anchor,
    inactive_days: Math.max(0, now.day - f.anchor),
    next,
    paused_until: paused?.until ?? null,
  };
}

// The demo bar's markers: the rungs of a learner whose last quiz, if any, was on day 0, as the seed's
// Omar and a learner just through the intake are. Fixed, so the root layout stays static.
export function ladderMarks(through = 24): { day: number; type: CoachEvent["type"] }[] {
  return rungsThrough({ anchor: 0, pause: null }, startOfDay(through)).map((r) => ({
    day: r.at.day,
    type: r.type,
  }));
}
