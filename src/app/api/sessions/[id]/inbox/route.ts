import { loadOmarSeed } from "../../../../../../demo/seed.ts";
import { config } from "../../../../../config.ts";
import { inboxResponse } from "../../../../../server/clock/http.ts";
import { createFileStore } from "../../../../../server/store/store.ts";

// POST /api/sessions/:id/inbox {"text": "توقف"} — the learner's reply from the simulated phone, at
// the session's sim time. A stop word opts out at once; answers {opted_out, confirmed}.
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[id]/inbox">) {
  const { id } = await ctx.params;
  return inboxResponse(request, id, {
    store: createFileStore(),
    seed: loadOmarSeed(config.demoTopic),
  });
}
