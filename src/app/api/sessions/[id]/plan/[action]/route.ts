import { loadOmarSeed } from "../../../../../../../demo/seed.ts";
import { config } from "../../../../../../config.ts";
import { createPlanner } from "../../../../../../server/agents/architect/architect.ts";
import { planResponse } from "../../../../../../server/agents/architect/http.ts";
import { savedProfile } from "../../../../../../server/agents/intake/intake.ts";
import { runScout, scoutBrief } from "../../../../../../server/agents/scout/scout.ts";
import { createOrchestrator } from "../../../../../../server/orchestrator/orchestrator.ts";
import { loadModels } from "../../../../../../server/providers/models.ts";
import { createProvider } from "../../../../../../server/providers/provider.ts";
import { createFileCache, createFileStore } from "../../../../../../server/store/store.ts";
import { createPageFetcher } from "../../../../../../server/tools/fetch-page.ts";
import { createTracer } from "../../../../../../server/trace/trace.ts";

// POST /api/sessions/:id/plan/{build,edit,accept,reject,reset} — the learner's plan (#18): build
// runs the scout and the architect for the intake's profile (the seed's until the intake is done, a
// plan the page never shows), edit takes
// {op: "move", session_id, day} or {op: "shorten", session_id, minutes}, accept and reject take the
// {version} the re-planner proposed (#26), reset forgets the plan. Each answers {plan}.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/plan/[action]">,
) {
  const { id, action } = await ctx.params;
  const store = createFileStore();
  const cache = createFileCache();
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
  const pages = createPageFetcher({
    profile: config.providerProfile,
    userAgent: `${config.appName}-scout/0.1 (checks the licence of open learning resources)`,
  });
  const planner = createPlanner({
    orchestrator,
    store,
    tracer: createTracer(store, id),
    sessionId: id,
    profile: () => savedProfile(store, id) ?? loadOmarSeed(config.demoTopic).profile,
    findResources: async (profile) =>
      (await runScout({ orchestrator, sessionId: id, brief: scoutBrief(profile), pages, cache }))
        .resources,
  });
  return planResponse(request, id, action, planner);
}
