import { loadOmarSeed } from "../../../../../../../demo/seed.ts";
import { config } from "../../../../../../config.ts";
import { simResponse } from "../../../../../../server/clock/http.ts";
import { createFileStore } from "../../../../../../server/store/store.ts";

// POST /api/sessions/:id/sim/advance {"days": 1, "minutes": 30}, /sim/set {"day": 10} and
// /sim/reset — move the session's simulated clock and answer {now, events}: the coach events the
// move fired. 409 for a time before now, 404 while SIM_CLOCK is off.
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[id]/sim/[action]">) {
  const { id, action } = await ctx.params;
  return simResponse(request, id, action, {
    store: createFileStore(),
    seed: loadOmarSeed(config.demoTopic),
    enabled: config.simClock,
  });
}
