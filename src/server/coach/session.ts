// The coach's view of a session (#24, #25): before the intake, the seed's Omar with his seeded
// consent, coach events and study; after it, the learner the interview saved, with no consent until
// the consent screen saves one, no coach events yet, so no coach message can reach them first, and
// the quizzes of the plan built for them, which their comeback (#27) recaps and re-plans.

import type { CoursePlan, Mastery, QuizAttempt } from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import { planFor, proposeReplan } from "../agents/architect/architect.ts";
import type { ReplanRequest } from "../agents/architect/replan.ts";
import { savedQuizzes } from "../agents/examiner/examiner.ts";
import { lessonOpen, recapQuiz } from "../agents/examiner/rules.ts";
import { savedProfile } from "../agents/intake/intake.ts";
import { EVENTS_DOC, LEDGER_DOC } from "../clock/scheduler.ts";
import { createSim, type SimSeed } from "../clock/sim.ts";
import { INBOX_DOC } from "../notifier/adapters.ts";
import { CONSENT_DOC, OUTBOX_DOC } from "../notifier/notifier.ts";
import { createOrchestrator } from "../orchestrator/orchestrator.ts";
import { loadModels } from "../providers/models.ts";
import { createProvider } from "../providers/provider.ts";
import { contentHash, type Store } from "../store/store.ts";
import { createTracer } from "../trace/trace.ts";
import { COACH_DOC, type CoachDeps, type Study } from "./coach.ts";

export type CoachSeed = SimSeed & Pick<Seed, "attempts" | "mastery" | "plans">;

// What the coach keeps for a learner. What the seed's Omar agreed to, was sent or replied before
// the intake, or an earlier interview's learner, is not the new learner's: those documents go once
// the profile changes.
const COACH_DOCS = [CONSENT_DOC, OUTBOX_DOC, INBOX_DOC, EVENTS_DOC, LEDGER_DOC, COACH_DOC];
const COACH_FOR_DOC = "coach_for";

// The issue's default (#24): no messages from 22:00 to 08:00, the learner's local time.
const DEFAULT_QUIET_HOURS = { start: "22:00", end: "08:00" };

export function sessionSimSeed(store: Store, sessionId: string, seed: SimSeed): SimSeed {
  const learner = savedProfile(store, sessionId);
  if (!learner) return seed;
  const forProfile = contentHash(learner);
  if (
    store.readDoc<{ for_profile: string }>(sessionId, COACH_FOR_DOC)?.for_profile !== forProfile
  ) {
    for (const name of COACH_DOCS) store.deleteDoc(sessionId, name);
    store.writeDoc(sessionId, COACH_FOR_DOC, { for_profile: forProfile });
  }
  return {
    profile: learner,
    consent: {
      learner_id: learner.id,
      channel: "simulated",
      granted: false,
      granted_sim_day: null,
      quiet_hours: DEFAULT_QUIET_HOURS,
      opted_out: false,
      opted_out_sim_day: null,
      intensity: "gentle",
    },
    coach_events: [],
  };
}

// The days of a plan's quizzes, and the first lesson open but not passed, with the best score on it.
function studied(
  plan: CoursePlan | undefined,
  attempts: QuizAttempt[],
  mastery: Mastery[],
): Omit<Study, "own_plan"> {
  const lessons = plan?.committed.lessons ?? [];
  const ids = lessons.map((l) => l.id);
  const passed = (id: string) => mastery.some((m) => m.lesson_id === id && m.passed);
  const current = lessons.find((l) => lessonOpen(ids, mastery, l.id) && !passed(l.id));
  const best = mastery.find((m) => m.lesson_id === current?.id)?.best_score;
  return {
    attempt_days: attempts.map((a) => a.sim_day),
    lesson: current
      ? {
          id: current.id,
          title_ar: current.title_ar,
          best_percent: best === undefined ? null : Math.round(best * 100),
        }
      : null,
  };
}

// The learner's own plan, its active version and its quizzes, once the intake has built one. Plan
// edits and re-plans keep the plan's id, so its quizzes stay with every version.
function ownPlan(store: Store, sessionId: string) {
  const learner = savedProfile(store, sessionId);
  const plan = learner && planFor(store, sessionId, learner)?.versions.at(-1);
  return plan ? { learner, plan, quizzes: savedQuizzes(store, sessionId, plan.id) } : undefined;
}

export function studyOf(store: Store, sessionId: string, seed: CoachSeed): Study {
  if (!savedProfile(store, sessionId)) {
    const latest = seed.plans.toSorted((a, b) => a.version - b.version).at(-1);
    return { ...studied(latest, seed.attempts, seed.mastery), own_plan: false };
  }
  const own = ownPlan(store, sessionId);
  if (!own) return { attempt_days: [], lesson: null, own_plan: false };
  const { attempts, mastery } = own.quizzes;
  return { ...studied(own.plan, attempts, mastery), own_plan: true };
}

// The recap over the lessons the learner passed on their own plan, with the quizzes it draws on.
function recapOf(store: Store, sessionId: string): ReturnType<CoachDeps["recap"]> {
  const own = ownPlan(store, sessionId);
  if (!own) return undefined;
  const { quizzes, attempts, mastery } = own.quizzes;
  const quiz = recapQuiz(quizzes, attempts, mastery);
  return quiz && { quiz, quizzes };
}

// The re-planner's proposal for the learner's return, from the lessons they passed. With no plan
// of their own it proposes nothing and asks no model.
function replanFor(
  store: Store,
  sessionId: string,
  seed: CoachSeed,
  steps: CoachDeps["steps"],
  request: ReplanRequest,
) {
  const own = ownPlan(store, sessionId);
  const passed = new Set(
    (own?.quizzes.mastery ?? []).filter((m) => m.passed).map((m) => m.lesson_id),
  );
  return proposeReplan(
    {
      store,
      sessionId,
      tracer: createTracer(store, sessionId),
      profile: own?.learner ?? seed.profile,
      steps,
    },
    request,
    passed,
  );
}

// The coach writer's and the re-planner's model calls, on the configured provider. A clock move
// waits for each message and a finished comeback for its explanation, so a call gets 30 s, not the
// provider's default.
export const coachSteps = (store: Store) =>
  createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({
        models: loadModels(),
        profile: config.providerProfile,
        apiKey: config.modelApiKey,
        replayLatency: config.replayLatency,
        onTrace,
        timeoutMs: 30_000,
      }),
  });

// The session's simulated coach and the learner it follows, as the pages read them. Only a clock
// move writes coach messages and only a finished comeback proposes a re-plan, so only the sim and
// comeback routes pass `steps` (coachSteps); without it each message and each explanation is its
// template.
export function sessionSim(
  store: Store,
  sessionId: string,
  seed: CoachSeed,
  steps: CoachDeps["steps"] = null,
) {
  const simSeed = sessionSimSeed(store, sessionId, seed);
  return {
    learner: simSeed.profile,
    sim: createSim({
      store,
      sessionId,
      seed: simSeed,
      coach: {
        steps,
        study: () => studyOf(store, sessionId, seed),
        replan: (request) => replanFor(store, sessionId, seed, steps, request),
        recap: () => recapOf(store, sessionId),
      },
    }),
  };
}
