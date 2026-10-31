// The coach's view of a session (#24, #25): before the intake, the seed's Omar with his seeded
// consent, coach events and study; after it, the learner the interview saved, with no consent until
// the consent screen saves one, no coach events yet, so no coach message can reach them first, and
// the quizzes of the plan built for them.

import type { CoursePlan, Mastery, QuizAttempt } from "../../../contracts/index.ts";
import type { Seed } from "../../../demo/seed.ts";
import { planFor, reviseLatest } from "../agents/architect/architect.ts";
import { shrinkPlan } from "../agents/architect/rules.ts";
import { savedQuizzes } from "../agents/examiner/examiner.ts";
import { lessonOpen } from "../agents/examiner/rules.ts";
import { savedProfile } from "../agents/intake/intake.ts";
import { EVENTS_DOC, LEDGER_DOC } from "../clock/scheduler.ts";
import { createSim, type SimSeed } from "../clock/sim.ts";
import { INBOX_DOC } from "../notifier/adapters.ts";
import { CONSENT_DOC, OUTBOX_DOC } from "../notifier/notifier.ts";
import { contentHash, type Store } from "../store/store.ts";
import { COACH_DOC, NO_PLAN, type Replanned, type Study } from "./coach.ts";

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
function studied(plan: CoursePlan | undefined, attempts: QuizAttempt[], mastery: Mastery[]): Study {
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

// Plan edits keep the plan's id, so its quizzes stay with every version.
export function studyOf(store: Store, sessionId: string, seed: CoachSeed): Study {
  const learner = savedProfile(store, sessionId);
  if (!learner) {
    const latest = seed.plans.toSorted((a, b) => a.version - b.version).at(-1);
    return studied(latest, seed.attempts, seed.mastery);
  }
  const plan = planFor(store, sessionId, learner)?.versions.at(-1);
  if (!plan) return { attempt_days: [], lesson: null };
  const { attempts, mastery } = savedQuizzes(store, sessionId, plan.id);
  return studied(plan, attempts, mastery);
}

const planMinutes = (plan: CoursePlan) =>
  plan.committed.sessions.reduce((sum, s) => sum + s.minutes, 0);

// The answer «جلسات أقصر» to the coach's check-in: the learner's latest plan with shorter sessions
// for the lessons they have not passed, saved as its next version. The seed's Omar has no plan of
// his own to change.
async function shrinkLatest(store: Store, sessionId: string): Promise<Replanned> {
  const learner = savedProfile(store, sessionId);
  const revised =
    learner &&
    reviseLatest(store, sessionId, learner, (latest, limits) => {
      const { mastery } = savedQuizzes(store, sessionId, latest.id);
      return shrinkPlan(
        latest,
        limits,
        new Set(mastery.filter((m) => m.passed).map((m) => m.lesson_id)),
      );
    });
  if (!revised) return NO_PLAN;
  const { latest, result } = revised;
  if (!result.ok) {
    return {
      ok: false,
      why: {
        en: result.violations.map((v) => v.en).join("; "),
        ar: `لم نغيّر خطتك: ${result.violations.map((v) => v.ar).join("، ")}.`,
      },
    };
  }
  return {
    ok: true,
    version: result.plan.version,
    minutes: { before: planMinutes(latest), after: planMinutes(result.plan) },
  };
}

// The session's simulated coach and the learner it follows, as the pages read them.
export function sessionSim(store: Store, sessionId: string, seed: CoachSeed) {
  const simSeed = sessionSimSeed(store, sessionId, seed);
  return {
    learner: simSeed.profile,
    sim: createSim({
      store,
      sessionId,
      seed: simSeed,
      coach: {
        study: () => studyOf(store, sessionId, seed),
        replan: () => shrinkLatest(store, sessionId),
      },
    }),
  };
}
