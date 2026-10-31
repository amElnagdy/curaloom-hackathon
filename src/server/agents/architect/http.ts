// HTTP view of the plan (#18): POST /api/sessions/:id/plan/{build,edit,accept,reject,reset}. Accept
// and reject answer the re-planner's proposal (#26) by its {version}. Each answers {plan}, the
// session's saved plan with every version (null after a reset).

import Type from "typebox";
import { BadRequest, jsonBody, parse, stillBuilding } from "../../clock/http.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { PlanConflict, PlanEditRejected, type Planner, type SavedPlan } from "./architect.ts";

const Empty = Type.Object({}, { additionalProperties: false });
const SessionId = Type.String({ maxLength: 64 });
const Edit = Type.Union([
  Type.Object(
    { op: Type.Literal("move"), session_id: SessionId, day: Type.Integer() },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal("shorten"), session_id: SessionId, minutes: Type.Integer() },
    { additionalProperties: false },
  ),
]);

const Version = Type.Object(
  { version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

const ACTIONS: Record<string, (planner: Planner, body: unknown) => Promise<SavedPlan | null>> = {
  build: (planner, body) => {
    parse(Empty, body);
    return planner.build();
  },
  edit: async (planner, body) => planner.edit(parse(Edit, body)),
  accept: async (planner, body) => planner.accept(parse(Version, body).version),
  reject: async (planner, body) => planner.reject(parse(Version, body).version),
  reset: async (planner, body) => {
    parse(Empty, body);
    planner.reset();
    return null;
  },
};

// A session whose plan is being built takes no second call until the build ends.
const busy = new Set<string>();

export async function planResponse(
  request: Request,
  sessionId: string,
  action: string,
  planner: Planner,
): Promise<Response> {
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!run) return new Response(null, { status: 404 });
  if (busy.has(sessionId)) {
    return stillBuilding("The plan is still being built");
  }
  busy.add(sessionId);
  try {
    return Response.json({ plan: await run(planner, await jsonBody(request)) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof PlanEditRejected) {
      return Response.json({ error, violations: e.violations }, { status: 400 });
    }
    if (e instanceof BadRequest) return Response.json({ error }, { status: e.status });
    if (e instanceof InvalidNameError) {
      return Response.json({ error }, { status: 400 });
    }
    if (e instanceof PlanConflict) return Response.json({ error }, { status: 409 });
    // The scout or the architect failed its step twice; the trace has why.
    if (e instanceof StepFailed) return Response.json({ error }, { status: 502 });
    throw e;
  } finally {
    busy.delete(sessionId);
  }
}
