// A session's simulated time (#23): the sim clock, the coach scheduler it drives, the coach whose
// ladder the scheduler fires (#25) and the notifier the scheduler sends through (#22). Each move
// returns the new time and the coach events it fired; a reply goes to the notifier's inbound
// handler, and a tap on a check-in's button to the coach. The HTTP routes are thin wrappers over it.

import type { CheckinReply, CoachEvent, Consent } from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import { config, type NotifierAdapterName } from "../../config.ts";
import { type CoachDeps, createCoach } from "../coach/coach.ts";
import { createAdapter } from "../notifier/adapters.ts";
import { type ConsentChoice, createNotifier, type ReplyResult } from "../notifier/notifier.ts";
import type { Store } from "../store/store.ts";
import { createTracer } from "../trace/trace.ts";
import { createSimClock } from "./clock.ts";
import { createScheduler, type RuleSource } from "./scheduler.ts";
import { type Duration, formatSimTime, type SimTime } from "./time.ts";

export type SimSeed = Pick<Seed, "profile" | "consent" | "coach_events">;

// `now` as "day 2 19:00".
export type SimResult = { now: string; events: CoachEvent[] };

export type SimOptions = {
  store: Store;
  sessionId: string;
  seed: SimSeed;
  coach?: CoachDeps;
  // Fired in place of the coach's ladder, for tests of the scheduler alone.
  rules?: RuleSource;
  adapter?: NotifierAdapterName;
};

// A learner with no quiz and no lesson yet: the ladder counts from day 0, no button opens a lesson
// and each message is its template.
const NO_STUDY: CoachDeps = {
  steps: null,
  study: () => ({ attempt_days: [], lesson: null }),
};

export function createSim({
  store,
  sessionId,
  seed,
  coach: deps = NO_STUDY,
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
  const learner = { id: seed.profile.id, name: seed.profile.name };
  const coach = createCoach({ store, sessionId, tracer, notifier, learner, ...deps });
  const scheduler = createScheduler({
    store,
    sessionId,
    tracer,
    notifier,
    learnerId: learner.id,
    initialEvents: seed.coach_events,
    rules: rules ?? coach.rules,
  });
  // The clock moves first, then the scheduler catches up on the window it crossed: a crash in
  // between leaves due rules that the next move fires.
  const moved = async (from: SimTime, to: SimTime): Promise<SimResult> => {
    coach.observe(from);
    return { now: formatSimTime(to), events: await scheduler.tick(to) };
  };

  return {
    now: clock.now,
    coachEvents: scheduler.events,
    consent: notifier.consent,
    outbox: notifier.outbox,
    ladder: () => coach.ladder(clock.now()),
    checkinReplies: coach.replies,
    advance: async (by: Duration) => {
      const from = clock.now();
      return moved(from, clock.advance(by));
    },
    set: async (day: number) => {
      const from = clock.now();
      return moved(from, clock.set(day));
    },
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
    // The learner's tap on a check-in's button, at the current sim time. Throws CheckinConflict for
    // a message they cannot answer.
    answer: (reply: CheckinReply) => coach.answer(reply, clock.now()),
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
