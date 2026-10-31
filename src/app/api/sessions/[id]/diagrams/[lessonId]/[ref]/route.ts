import { diagramImageResponse } from "../../../../../../../server/agents/diagrams/http.ts";
import { createFileStore } from "../../../../../../../server/store/store.ts";

// GET /api/sessions/:id/diagrams/:lessonId/:ref — an image one of the lesson's diagrams shows (#28).
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/diagrams/[lessonId]/[ref]">,
) {
  const { id, lessonId, ref } = await ctx.params;
  return diagramImageResponse(createFileStore(), id, lessonId, ref);
}
