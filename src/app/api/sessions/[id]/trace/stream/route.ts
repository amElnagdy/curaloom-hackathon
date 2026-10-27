import { createFileStore } from "../../../../../../server/store/store.ts";
import { traceStream } from "../../../../../../server/trace/http.ts";

export const dynamic = "force-dynamic";

// GET /api/sessions/:id/trace/stream — server-sent events for the trace panel.
export async function GET(request: Request, ctx: RouteContext<"/api/sessions/[id]/trace/stream">) {
  const { id } = await ctx.params;
  const after =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  return traceStream(createFileStore(), id, after, { signal: request.signal });
}
