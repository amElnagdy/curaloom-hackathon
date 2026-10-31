import { diagramImageResponse } from "../../../../../../../server/agents/diagrams/http.ts";
import { createFileStore } from "../../../../../../../server/store/store.ts";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/diagrams/[lessonId]/[ref]">,
) {
  const { id, lessonId, ref } = await ctx.params;
  return diagramImageResponse(createFileStore(), id, lessonId, ref);
}
