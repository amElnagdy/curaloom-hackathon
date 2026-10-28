// The consent gate (#22, ADR-004): decides, before any adapter call, whether a message may go now,
// must wait for quiet hours to end, or must not go at all. Pure: consent and a simulated time in,
// a decision out. The first rule that applies decides.

import type { Consent } from "../../../contracts/index.ts";
import { minuteOfDay, type SimTime } from "../clock/time.ts";

// A coach message, or the one reply the system sends to a stop word.
export type MessageKind = "coach" | "opt_out_confirmation";

export type GateDecision =
  | { status: "send"; rule: "confirm_opt_out" | "allowed" }
  | { status: "suppressed_opt_out"; rule: "opted_out" | "not_granted" }
  | { status: "deferred"; rule: "quiet_hours"; deliver_at: SimTime };

type GateInput = { consent: Consent; at: SimTime; kind: MessageKind };
type GateRule = (input: GateInput) => GateDecision | null;

// The end of the quiet window `at` falls in, or null outside quiet hours. The end is not quiet.
// A window whose start is after its end crosses midnight, as the seed's 22:00 to 12:00 does.
export function quietUntil(quiet: Consent["quiet_hours"], at: SimTime): SimTime | null {
  if (!quiet) return null;
  const start = minuteOfDay(quiet.start);
  const end = minuteOfDay(quiet.end);
  const m = at.minute;
  if (start < end) return m >= start && m < end ? { day: at.day, minute: end } : null;
  if (start > end) {
    if (m >= start) return { day: at.day + 1, minute: end };
    if (m < end) return { day: at.day, minute: end };
  }
  return null;
}

const RULES: readonly GateRule[] = [
  // The confirmation answers the stop word that just opted the learner out, so it is the one
  // message that passes an opt-out. The notifier sends it once, on the change to opted out.
  ({ kind }) =>
    kind === "opt_out_confirmation" ? { status: "send", rule: "confirm_opt_out" } : null,
  ({ consent }) => (consent.opted_out ? { status: "suppressed_opt_out", rule: "opted_out" } : null),
  ({ consent }) => (consent.granted ? null : { status: "suppressed_opt_out", rule: "not_granted" }),
  ({ consent, at }) => {
    const deliver_at = quietUntil(consent.quiet_hours, at);
    return deliver_at ? { status: "deferred", rule: "quiet_hours", deliver_at } : null;
  },
];

export function gate(consent: Consent, at: SimTime, kind: MessageKind = "coach"): GateDecision {
  for (const rule of RULES) {
    const decision = rule({ consent, at, kind });
    if (decision) return decision;
  }
  return { status: "send", rule: "allowed" };
}
