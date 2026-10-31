// HTTP view of the quizzes (#20). POST /api/sessions/:id/quizzes/:lessonId writes the lesson's quiz
// to take if there is none, and answers the lesson's quiz view with that quiz's keys left out. POST
// .../quizzes/:lessonId/attempts {quiz_id, answers} grades an attempt and answers it with the view.
// GET .../quizzes/recap answers a short quiz over the lessons passed, without its keys.

import Type from "typebox";
import { BadRequest, jsonBody, parse, stillBuilding } from "../../clock/http.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { AttemptInvalid, type Examiner, QuizConflict, QuizNotFound } from "./examiner.ts";
import { type QuizView, withoutKeys } from "./rules.ts";

const Empty = Type.Object({}, { additionalProperties: false });
const Attempt = Type.Object(
  {
    quiz_id: Type.String({ minLength: 1, maxLength: 200 }),
    answers: Type.Array(
      Type.Object(
        {
          item_id: Type.String({ minLength: 1, maxLength: 50 }),
          response: Type.String({ maxLength: 2000 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 20 },
    ),
  },
  { additionalProperties: false },
);

// The view with the quiz to take, its keys left out; earlier quizzes were answered already.
const shown = ({ quizzes, ...view }: QuizView) => {
  const last = quizzes.at(-1);
  return { ...view, quizzes: quizzes.slice(0, -1), quiz: last && withoutKeys(last) };
};

// A session writes one quiz and grades one attempt at a time.
const busy = new Set<string>();

async function answer(key: string, busyError: string, work: () => Promise<unknown>) {
  if (busy.has(key)) return stillBuilding(busyError);
  busy.add(key);
  try {
    return Response.json(await work());
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof BadRequest) return Response.json({ error }, { status: e.status });
    if (e instanceof InvalidNameError || e instanceof AttemptInvalid) {
      return Response.json({ error }, { status: 400 });
    }
    if (e instanceof QuizNotFound) return Response.json({ error }, { status: 404 });
    if (e instanceof QuizConflict) return Response.json({ error }, { status: 409 });
    // The examiner failed its step twice; the trace has why.
    if (e instanceof StepFailed) return Response.json({ error }, { status: 502 });
    throw e;
  } finally {
    busy.delete(key);
  }
}

export const quizResponse = (
  request: Request,
  sessionId: string,
  lessonId: string,
  examiner: Examiner,
) =>
  answer(`quiz:${sessionId}`, "A quiz is still being written", async () => {
    parse(Empty, await jsonBody(request));
    return shown(await examiner.quiz(lessonId));
  });

export const attemptResponse = (
  request: Request,
  sessionId: string,
  lessonId: string,
  examiner: Examiner,
) =>
  answer(`attempt:${sessionId}`, "An attempt is still being graded", async () => {
    const body = parse(Attempt, await jsonBody(request));
    const { attempt, ...view } = await examiner.attempt(lessonId, body.quiz_id, body.answers);
    return { attempt, ...shown(view) };
  });

export function recapResponse(examiner: Examiner): Response {
  try {
    const quiz = examiner.recap();
    if (!quiz) return Response.json({ error: "No lesson is passed yet" }, { status: 409 });
    return Response.json({ quiz: withoutKeys(quiz) });
  } catch (e) {
    if (e instanceof InvalidNameError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
