import { loadOmarSeed } from "../../../../../../../demo/seed.ts";
import { config } from "../../../../../../config.ts";
import { comebackResponse } from "../../../../../../server/clock/http.ts";
import { coachSteps, sessionSim } from "../../../../../../server/coach/session.ts";
import { createFileStore } from "../../../../../../server/store/store.ts";

// POST /api/sessions/:id/comeback/open {}, /comeback/recap {quiz_id, answers} and /comeback/replan
// {} — the learner's return (#27) at the session's sim time. open records it once the plan page
// sees them back and answers {comeback}; recap grades the recap in code, then proposes the re-plan,
// worded by the re-planner's model, and answers {comeback, replanned}; replan does that with no
// recap while no lesson is passed. 409 when no comeback is due or the recap is not the one to take,
// 400 for a bad body or answers the recap cannot take, 404 for an unknown step.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/comeback/[action]">,
) {
  const { id, action } = await ctx.params;
  const store = createFileStore();
  const seed = loadOmarSeed(config.demoTopic);
  const steps = coachSteps(store);
  return comebackResponse(request, id, action, {
    sim: (sessionId) => sessionSim(store, sessionId, seed, steps).sim,
  });
}
