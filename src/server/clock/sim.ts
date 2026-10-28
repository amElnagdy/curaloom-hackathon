// A session's simulated time (#23): the sim clock and the coach scheduler it drives. Each move
// returns the new time and the coach events it fired; the HTTP routes are thin wrappers over it.

import type { CoachEvent } from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import type { Store } from "../store/store.ts";
import { createTracer } from "../trace/trace.ts";
import { createSimClock } from "./clock.ts";
import { type CoachRule, createScheduler } from "./scheduler.ts";
import { type Duration, formatSimTime, type SimTime } from "./time.ts";

export type SimSeed = Pick<Seed, "profile" | "coach_events">;

// `now` as "day 2 19:00".
export type SimResult = { now: string; events: CoachEvent[] };

export type SimOptions = {
  store: Store;
  sessionId: string;
  seed: SimSeed;
  rules?: readonly CoachRule[];
};

export function createSim({ store, sessionId, seed, rules }: SimOptions) {
  const tracer = createTracer(store, sessionId);
  const clock = createSimClock(store, sessionId, tracer);
  const scheduler = createScheduler({
    store,
    sessionId,
    tracer,
    context: { learner: { id: seed.profile.id, name: seed.profile.name } },
    initialEvents: seed.coach_events,
    rules,
  });
  // The clock moves first, then the scheduler catches up on the window it crossed: a crash in
  // between leaves due rules that the next move fires.
  const moved = (to: SimTime): SimResult => ({
    now: formatSimTime(to),
    events: scheduler.tick(to),
  });

  return {
    now: clock.now,
    coachEvents: scheduler.events,
    advance: (by: Duration) => moved(clock.advance(by)),
    set: (day: number) => moved(clock.set(day)),
    // Back to the seeded demo state: every session document goes, the trace stays.
    reset(): SimResult {
      store.clearDocs(sessionId);
      return { now: formatSimTime(clock.reset()), events: [] };
    },
  };
}
