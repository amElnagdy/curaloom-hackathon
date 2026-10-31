import { config } from "../../../../../../config.ts";
import { transcribeResponse } from "../../../../../../server/agents/intake/http.ts";
import { transcribeVoice } from "../../../../../../server/agents/intake/intake.ts";
import { loadModels } from "../../../../../../server/providers/models.ts";
import { createProvider } from "../../../../../../server/providers/provider.ts";
import { createFileStore } from "../../../../../../server/store/store.ts";
import { createTracer } from "../../../../../../server/trace/trace.ts";

// POST /api/sessions/:id/intake/transcribe — the learner's voice message in the intake (#37): a mono
// 16-bit PCM WAV body (audio/wav, 2 MB at most) in, {text} out for the composer. The provider traces
// the call to the session's trace.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/intake/transcribe">,
) {
  const { id } = await ctx.params;
  const store = createFileStore();
  const provider = createProvider({
    models: loadModels(),
    profile: config.providerProfile,
    apiKey: config.modelApiKey,
    replayLatency: config.replayLatency,
    onTrace: createTracer(store, id).fromProvider,
  });
  return transcribeResponse(request, (audio) =>
    transcribeVoice({ store, sessionId: id, provider }, audio),
  );
}
