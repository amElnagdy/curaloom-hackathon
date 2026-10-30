import { loadOmarSeed } from "../../../../../../demo/seed.ts";
import { config } from "../../../../../config.ts";
import { courseOf, createExaminer } from "../../../../../server/agents/examiner/examiner.ts";
import { savedProfile } from "../../../../../server/agents/intake/intake.ts";
import { createOrchestrator } from "../../../../../server/orchestrator/orchestrator.ts";
import { loadModels } from "../../../../../server/providers/models.ts";
import { createProvider } from "../../../../../server/providers/provider.ts";
import { createFileStore } from "../../../../../server/store/store.ts";

// The session's examiner (#20), on the plan built for the intake's profile, the seed's until the
// intake is done, and the lessons written for it.
export function examinerFor(sessionId: string) {
  const store = createFileStore();
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({
        models: loadModels(),
        profile: config.providerProfile,
        apiKey: config.modelApiKey,
        onTrace,
      }),
  });
  const profile = () => savedProfile(store, sessionId) ?? loadOmarSeed(config.demoTopic).profile;
  return createExaminer({
    orchestrator,
    store,
    sessionId,
    course: () => courseOf(store, sessionId, profile()),
  });
}
