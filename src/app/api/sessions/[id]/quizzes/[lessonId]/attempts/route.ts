import { attemptResponse } from "../../../../../../../server/agents/examiner/http.ts";
import { examinerFor } from "../../examiner.ts";

// POST /api/sessions/:id/quizzes/:lessonId/attempts {quiz_id, answers} — grades an attempt at the
// lesson's quiz to take (#20), keeps it and the lesson's mastery, and answers {attempt} with the
// lesson's quizzes.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/quizzes/[lessonId]/attempts">,
) {
  const { id, lessonId } = await ctx.params;
  return attemptResponse(request, id, lessonId, examinerFor(id));
}
