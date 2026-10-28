// The clock module (ADR-004, #23): the only code that reads system time, and the per-session
// simulated clock. Every move persists in the session store and emits one trace event under the
// agent "clock".

import type { Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import {
  compareSimTime,
  DAY_ZERO,
  type Duration,
  formatSimTime,
  hhmm,
  later,
  type SimTime,
  startOfDay,
} from "./time.ts";

// The one place that constructs the current wall time.
export function wallNow(): Date {
  return new Date();
}

export type SimClock = {
  now(): SimTime;
  advance(by: Duration): SimTime;
  // Jumps to the start of `day`.
  set(day: number): SimTime;
  reset(): SimTime;
};

// The clock only moves forward; reset is the way back.
export class ClockError extends Error {}

const CLOCK_DOC = "sim_clock";

// A session that has never moved its clock is at day 0, like the seed.
export function readSimNow(store: Store, sessionId: string): SimTime {
  return store.readDoc<{ now: SimTime }>(sessionId, CLOCK_DOC)?.now ?? DAY_ZERO;
}

function arabic(t: SimTime): string {
  const day = t.day === 0 ? "يوم البدء" : `اليوم ${t.day}`;
  return `${day}، الساعة ${hhmm(t.minute)}`;
}

export function createSimClock(store: Store, sessionId: string, tracer: Tracer): SimClock {
  const now = () => readSimNow(store, sessionId);
  const moveTo = (to: SimTime, summary_ar: string, summary_en: string): SimTime => {
    store.writeDoc(sessionId, CLOCK_DOC, { now: to });
    tracer.emit({ agent: "clock", kind: "decision", summary_ar, summary_en });
    return to;
  };
  const forward = (from: SimTime, to: SimTime) => {
    if (compareSimTime(to, from) < 0) {
      throw new ClockError(
        `The clock only moves forward: ${formatSimTime(to)} is before ${formatSimTime(from)}`,
      );
    }
    return to;
  };

  return {
    now,
    advance(by) {
      const from = now();
      const to = forward(from, later(from, by));
      return moveTo(
        to,
        `تقدّمت الساعة المحاكاة إلى ${arabic(to)}`,
        `Clock advanced from ${formatSimTime(from)} to ${formatSimTime(to)}`,
      );
    },
    set(day) {
      const from = now();
      const to = forward(from, startOfDay(day));
      return moveTo(
        to,
        `قفزت الساعة المحاكاة إلى ${arabic(to)}`,
        `Clock set from ${formatSimTime(from)} to ${formatSimTime(to)}`,
      );
    },
    reset: () =>
      moveTo(
        DAY_ZERO,
        `أُعيدت الساعة المحاكاة إلى ${arabic(DAY_ZERO)}`,
        `Clock reset to ${formatSimTime(DAY_ZERO)}`,
      ),
  };
}
