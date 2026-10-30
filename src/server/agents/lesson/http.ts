// HTTP view of the lessons (#19): POST /api/sessions/:id/lessons/:lessonId writes that lesson of
// the learner's plan if it is not written yet, and answers {lessons}, the session's lessons and
// their glossary.

import Type from "typebox";
import { BadRequest, jsonBody, parse } from "../../clock/http.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { type LessonBuilder, LessonConflict, LessonNotFound } from "./lesson.ts";

const Empty = Type.Object({}, { additionalProperties: false });

// A session writes one lesson at a time, since each lesson adds to the glossary the next one reads.
const busy = new Set<string>();

export async function lessonResponse(
  request: Request,
  sessionId: string,
  lessonId: string,
  builder: LessonBuilder,
): Promise<Response> {
  if (busy.has(sessionId)) {
    return Response.json({ error: "A lesson is still being written" }, { status: 409 });
  }
  busy.add(sessionId);
  try {
    parse(Empty, await jsonBody(request));
    return Response.json({ lessons: await builder.build(lessonId) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof BadRequest || e instanceof InvalidNameError) {
      return Response.json({ error }, { status: 400 });
    }
    if (e instanceof LessonNotFound) return Response.json({ error }, { status: 404 });
    if (e instanceof LessonConflict) return Response.json({ error }, { status: 409 });
    // The lesson builder failed its step twice; the trace has why.
    if (e instanceof StepFailed) return Response.json({ error }, { status: 502 });
    throw e;
  } finally {
    busy.delete(sessionId);
  }
}
