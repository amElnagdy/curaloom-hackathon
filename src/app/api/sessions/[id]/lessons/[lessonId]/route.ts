import { loadOmarSeed } from "../../../../../../../demo/seed.ts";
import { config } from "../../../../../../config.ts";
import { savedQuizzes } from "../../../../../../server/agents/examiner/examiner.ts";
import { savedProfile } from "../../../../../../server/agents/intake/intake.ts";
import { lessonResponse } from "../../../../../../server/agents/lesson/http.ts";
import { createLessonBuilder } from "../../../../../../server/agents/lesson/lesson.ts";
import { createOrchestrator } from "../../../../../../server/orchestrator/orchestrator.ts";
import { loadModels } from "../../../../../../server/providers/models.ts";
import { createProvider } from "../../../../../../server/providers/provider.ts";
import { createFileStore } from "../../../../../../server/store/store.ts";
import { createPageFetcher } from "../../../../../../server/tools/fetch-page.ts";

// POST /api/sessions/:id/lessons/:lessonId — writes that lesson of the learner's plan (#19) from
// its resources, once per plan, once the quiz gate opens it (#34), and answers {lessons}. The plan is the one built for the intake's
// profile, the seed's until the intake is done.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/lessons/[lessonId]">,
) {
  const { id, lessonId } = await ctx.params;
  const store = createFileStore();
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({
        models: loadModels(),
        profile: config.providerProfile,
        apiKey: config.modelApiKey,
        replayLatency: config.replayLatency,
        onTrace,
      }),
  });
  const builder = createLessonBuilder({
    orchestrator,
    store,
    sessionId: id,
    pages: createPageFetcher({
      profile: config.providerProfile,
      userAgent: `${config.appName}-lessons/0.1 (quotes the open learning resources it cites)`,
    }),
    profile: () => savedProfile(store, id) ?? loadOmarSeed(config.demoTopic).profile,
    mastery: (planId) => savedQuizzes(store, id, planId).mastery,
  });
  return lessonResponse(request, id, lessonId, builder);
}
