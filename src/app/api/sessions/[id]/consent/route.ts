import { loadOmarSeed } from "../../../../../../demo/seed.ts";
import { config } from "../../../../../config.ts";
import { consentResponse } from "../../../../../server/clock/http.ts";
import { sessionSim } from "../../../../../server/coach/session.ts";
import { createFileStore } from "../../../../../server/store/store.ts";

// POST /api/sessions/:id/consent {"messages": true, "quiet_hours": {"start": "22:00", "end":
// "08:00"}, "intensity": "gentle"} — the consent screen's save (#24), at the session's sim time.
// Turning messages off opts out as «توقف» does. Answers {consent}; 400 for a bad body.
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[id]/consent">) {
  const { id } = await ctx.params;
  const store = createFileStore();
  const seed = loadOmarSeed(config.demoTopic);
  return consentResponse(request, id, {
    sim: (sessionId) => sessionSim(store, sessionId, seed).sim,
  });
}
