// HTTP view of the intake (#16): POST /api/sessions/:id/intake/{start,message,answers,reset}.
// Each answers {view}, the interview as it now stands (null after a reset).

import Type from "typebox";
import { BadRequest, jsonBody, parse } from "../../clock/http.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { InvalidAnswers } from "./diagnostic.ts";
import { type Intake, IntakeConflict, type IntakeView } from "./intake.ts";

const Empty = Type.Object({}, { additionalProperties: false });
const Message = Type.Object(
  { text: Type.String({ maxLength: 1000, pattern: "\\S" }) },
  { additionalProperties: false },
);
const Answers = Type.Object(
  { answers: Type.Record(Type.String(), Type.String({ maxLength: 500 })) },
  { additionalProperties: false },
);

const ACTIONS: Record<string, (intake: Intake, body: unknown) => Promise<IntakeView | null>> = {
  start: async (intake, body) => {
    parse(Empty, body);
    return intake.start();
  },
  message: (intake, body) => intake.message(parse(Message, body).text),
  answers: (intake, body) => intake.answer(parse(Answers, body).answers),
  reset: async (intake, body) => {
    parse(Empty, body);
    intake.reset();
    return null;
  },
};

// A session waiting on a model reply takes no second call until it has its answer.
const busy = new Set<string>();

export async function intakeResponse(
  request: Request,
  sessionId: string,
  action: string,
  intake: Intake,
): Promise<Response> {
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!run) return new Response(null, { status: 404 });
  if (busy.has(sessionId)) {
    return Response.json({ error: "The interview is still answering" }, { status: 409 });
  }
  busy.add(sessionId);
  try {
    return Response.json({ view: await run(intake, await jsonBody(request)) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof IntakeConflict) return Response.json({ error }, { status: 409 });
    if (e instanceof BadRequest || e instanceof InvalidAnswers || e instanceof InvalidNameError) {
      return Response.json({ error }, { status: 400 });
    }
    // The model failed the step twice; the trace has why.
    if (e instanceof StepFailed) return Response.json({ error }, { status: 502 });
    throw e;
  } finally {
    busy.delete(sessionId);
  }
}
