import { recapResponse } from "../../../../../../server/agents/examiner/http.ts";
import { examinerFor } from "../examiner.ts";

// GET /api/sessions/:id/quizzes/recap — a short quiz over the lessons passed (#20, for #27), without
// its keys; 409 before a lesson is passed.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/quizzes/recap">,
) {
  const { id } = await ctx.params;
  return recapResponse(examinerFor(id));
}
