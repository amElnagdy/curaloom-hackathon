import { createFileStore } from "../../../../../server/store/store.ts";
import { traceJson } from "../../../../../server/trace/http.ts";

// GET /api/sessions/:id/trace?after=evt_0001 — trace events in order, for polling.
export async function GET(request: Request, ctx: RouteContext<"/api/sessions/[id]/trace">) {
  const { id } = await ctx.params;
  return traceJson(createFileStore(), id, new URL(request.url).searchParams.get("after"));
}
