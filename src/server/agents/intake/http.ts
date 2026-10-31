// HTTP view of the intake (#16): POST /api/sessions/:id/intake/{start,message,answers,reset}.
// Each answers {view}, the interview as it now stands (null after a reset). POST
// /api/sessions/:id/intake/transcribe takes a voice message as WAV and answers {text} (#37).

import Type from "typebox";
import { audioBody, BadRequest, jsonBody, parse } from "../../clock/http.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { InvalidAnswers } from "./diagnostic.ts";
import { type Intake, IntakeConflict, type IntakeView } from "./intake.ts";
import { transcribableWav } from "./wav.ts";

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
    if (e instanceof BadRequest) return Response.json({ error }, { status: e.status });
    if (e instanceof InvalidAnswers || e instanceof InvalidNameError) {
      return Response.json({ error }, { status: 400 });
    }
    // The model failed the step twice; the trace has why.
    if (e instanceof StepFailed) return Response.json({ error }, { status: 502 });
    throw e;
  } finally {
    busy.delete(sessionId);
  }
}

// The transcript only fills the composer: the learner reads it and sends it, or not. 400 for audio
// the transcriber does not take, 409 outside the interview, 413 over the cap, and 502 when the
// transcriber fails after the provider's retries or replay has no recording of the audio; the trace
// has why.
export async function transcribeResponse(
  request: Request,
  transcribe: (audio: Uint8Array) => Promise<string>,
): Promise<Response> {
  try {
    const audio = await audioBody(request);
    if (!transcribableWav(audio)) {
      throw new BadRequest("Audio must be a RIFF WAV file, mono, 16-bit PCM, at 16 or 24 kHz");
    }
    return Response.json({ text: await transcribe(audio) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof BadRequest) return Response.json({ error }, { status: e.status });
    if (e instanceof InvalidNameError) return Response.json({ error }, { status: 400 });
    if (e instanceof IntakeConflict) return Response.json({ error }, { status: 409 });
    return Response.json({ error }, { status: 502 });
  }
}
