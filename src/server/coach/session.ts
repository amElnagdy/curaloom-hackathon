// The coach's view of a session (#24): before the intake, the seed's Omar with his seeded consent
// and coach events; after it, the learner the interview saved, with no consent until the consent
// screen saves one and no coach events yet, so no coach message can reach them first.

import { savedProfile } from "../agents/intake/intake.ts";
import { EVENTS_DOC, LEDGER_DOC } from "../clock/scheduler.ts";
import { createSim, type SimSeed } from "../clock/sim.ts";
import { INBOX_DOC } from "../notifier/adapters.ts";
import { CONSENT_DOC, OUTBOX_DOC } from "../notifier/notifier.ts";
import { contentHash, type Store } from "../store/store.ts";

// What the coach keeps for a learner. What the seed's Omar agreed to, was sent or replied before
// the intake, or an earlier interview's learner, is not the new learner's: those documents go once
// the profile changes.
const COACH_DOCS = [CONSENT_DOC, OUTBOX_DOC, INBOX_DOC, EVENTS_DOC, LEDGER_DOC];
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

// The session's simulated coach and the learner it follows, as the pages read them.
export function sessionSim(store: Store, sessionId: string, seed: SimSeed) {
  const simSeed = sessionSimSeed(store, sessionId, seed);
  return { learner: simSeed.profile, sim: createSim({ store, sessionId, seed: simSeed }) };
}
