import { loadOmarSeed } from "../../../../../../../demo/seed.ts";
import { config } from "../../../../../../config.ts";
import {
  createDiagramsBuilder,
  lessonDiagramsBrief,
  writtenCourse,
} from "../../../../../../server/agents/diagrams/diagrams.ts";
import { diagramsResponse } from "../../../../../../server/agents/diagrams/http.ts";
import { savedProfile } from "../../../../../../server/agents/intake/intake.ts";
import { createOrchestrator } from "../../../../../../server/orchestrator/orchestrator.ts";
import { loadModels } from "../../../../../../server/providers/models.ts";
import { createProvider } from "../../../../../../server/providers/provider.ts";
import { createFileStore } from "../../../../../../server/store/store.ts";
import { createPageFetcher } from "../../../../../../server/tools/fetch-page.ts";

// POST /api/sessions/:id/diagrams/:lessonId — makes the written lesson's diagrams (#28) once, from
// the images of the Wikimedia pages it quotes, and answers {diagrams}. The lesson page asks for
// them while the learner reads.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/diagrams/[lessonId]">,
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
  const builder = createDiagramsBuilder({
    orchestrator,
    store,
    sessionId: id,
    pages: createPageFetcher({
      profile: config.providerProfile,
      userAgent: `${config.appName}-diagrams/0.1 (relabels the openly licensed diagrams of the pages it cites)`,
    }),
    brief: (lessonId) => {
      const learner = savedProfile(store, id) ?? loadOmarSeed(config.demoTopic).profile;
      const course = writtenCourse(store, id, learner);
      return course && lessonDiagramsBrief(course, lessonId);
    },
  });
  return diagramsResponse(request, id, lessonId, builder);
}
