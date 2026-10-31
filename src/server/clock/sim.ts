// A session's simulated time (#23): the sim clock, the coach scheduler it drives and the notifier
// the scheduler sends through (#22). Each move returns the new time and the coach events it fired;
// a reply goes to the notifier's inbound handler. The HTTP routes are thin wrappers over it.

import type { CoachEvent, Consent } from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import { config, type NotifierAdapterName } from "../../config.ts";
import { createAdapter } from "../notifier/adapters.ts";
import { type ConsentChoice, createNotifier, type ReplyResult } from "../notifier/notifier.ts";
import type { Store } from "../store/store.ts";
import { createTracer } from "../trace/trace.ts";
import { createSimClock } from "./clock.ts";
import { type CoachRule, createScheduler } from "./scheduler.ts";
import { type Duration, formatSimTime, type SimTime } from "./time.ts";

export type SimSeed = Pick<Seed, "profile" | "consent" | "coach_events">;

// `now` as "day 2 19:00".
export type SimResult = { now: string; events: CoachEvent[] };

export type SimOptions = {
  store: Store;
  sessionId: string;
  seed: SimSeed;
  rules?: readonly CoachRule[];
  adapter?: NotifierAdapterName;
};

export function createSim({
  store,
  sessionId,
  seed,
  rules,
  adapter = config.notifierAdapter,
}: SimOptions) {
  const tracer = createTracer(store, sessionId);
  const clock = createSimClock(store, sessionId, tracer);
  const notifier = createNotifier({
    store,
    sessionId,
    adapter: createAdapter(adapter, store, sessionId),
    tracer,
    initialConsent: seed.consent,
  });
  const scheduler = createScheduler({
    store,
    sessionId,
    tracer,
    notifier,
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
    consent: notifier.consent,
    outbox: notifier.outbox,
    advance: (by: Duration) => moved(clock.advance(by)),
    set: (day: number) => moved(clock.set(day)),
    // The consent screen's save (#24), at the current sim time.
    setConsent(choice: ConsentChoice): Consent {
      const consent = notifier.setConsent(choice, clock.now());
      scheduler.syncStatuses();
      return consent;
    },
    // The learner's reply from the phone, at the current sim time.
    reply(text: string): ReplyResult {
      const result = notifier.receive(text, clock.now());
      scheduler.syncStatuses();
      return result;
    },
    // Back to the seeded demo state: every session document goes and readers fall back to the
    // seed (ADR-003). The trace stays, and says what came back.
    reset(): SimResult {
      store.clearDocs(sessionId);
      const now = clock.reset();
      tracer.emit({
        agent: "sim",
        kind: "decision",
        at: now,
        summary_ar:
          "أُعيد العرض إلى بدايته: الموافقة ورسائل المدرب والهاتف كما في البيانات التجريبية",
        summary_en: "Session reset to the seed: consent, coach events, inbox and outbox",
      });
      return { now: formatSimTime(now), events: [] };
    },
  };
}
