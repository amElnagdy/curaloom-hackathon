import { loadOmarSeed } from "../../../../../../../demo/seed.ts";
import { config } from "../../../../../../config.ts";
import { intakeResponse } from "../../../../../../server/agents/intake/http.ts";
import { createIntake } from "../../../../../../server/agents/intake/intake.ts";
import { createOrchestrator } from "../../../../../../server/orchestrator/orchestrator.ts";
import { loadModels } from "../../../../../../server/providers/models.ts";
import { createProvider } from "../../../../../../server/providers/provider.ts";
import { createFileCache, createFileStore } from "../../../../../../server/store/store.ts";

// POST /api/sessions/:id/intake/{start,message,answers,reset} — the intake chat (#16): start
// greets, message takes {text}, answers takes {answers: {q1: "<option>", …}}, reset starts over.
// Each answers {view}. The session's learner is the seed's until accounts exist.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/intake/[action]">,
) {
  const { id, action } = await ctx.params;
  const store = createFileStore();
  const { profile } = loadOmarSeed(config.demoTopic);
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
  const intake = createIntake({
    orchestrator,
    store,
    cache: createFileCache(),
    sessionId: id,
    learner: { id: profile.id, name: profile.name },
    topic: config.demoTopic,
  });
  return intakeResponse(request, id, action, intake);
}
