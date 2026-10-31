import { loadOmarSeed } from "../../../../../../demo/seed.ts";
import { config } from "../../../../../config.ts";
import { inboxResponse } from "../../../../../server/clock/http.ts";
import { sessionSim } from "../../../../../server/coach/session.ts";
import { createFileStore } from "../../../../../server/store/store.ts";

// POST /api/sessions/:id/inbox {"text": "توقف"} — the learner's reply from the simulated phone, at
// the session's sim time. A stop word opts out at once; answers {opted_out, confirmed}.
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[id]/inbox">) {
  const { id } = await ctx.params;
  const store = createFileStore();
  const seed = loadOmarSeed(config.demoTopic);
  return inboxResponse(request, id, {
    sim: (sessionId) => sessionSim(store, sessionId, seed).sim,
  });
}
