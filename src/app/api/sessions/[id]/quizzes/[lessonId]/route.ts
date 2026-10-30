import { quizResponse } from "../../../../../../server/agents/examiner/http.ts";
import { examinerFor } from "../examiner.ts";

// POST /api/sessions/:id/quizzes/:lessonId — writes the lesson's quiz to take (#20) if there is
// none, or a new one with other questions after an attempt below the gate, and answers the
// lesson's quizzes with that quiz's keys left out. The lesson page asks for it while the learner
// reads.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/quizzes/[lessonId]">,
) {
  const { id, lessonId } = await ctx.params;
  return quizResponse(request, id, lessonId, examinerFor(id));
}
