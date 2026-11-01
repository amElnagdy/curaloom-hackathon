import { createFileStore, InvalidNameError } from "../../../../../server/store/store.ts";
import { planKind } from "../../../../_shell/lessons.ts";

// GET /api/sessions/:id/plan — whose plan the session follows, as {kind}: "sample" before the
// intake, "own" once the learner's plan is built, "none" in between. The demo bar and Settings keep
// the clock still while it is "none" (#61). Reads only; 400 for a bad session id.
export async function GET(_request: Request, ctx: RouteContext<"/api/sessions/[id]/plan">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ kind: planKind(createFileStore(), id) });
  } catch (e) {
    if (e instanceof InvalidNameError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
