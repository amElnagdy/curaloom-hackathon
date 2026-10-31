// HTTP view of a lesson's diagrams (#28). POST /api/sessions/:id/diagrams/:lessonId makes the
// written lesson's diagrams if there are none for it yet and answers {diagrams}. GET
// .../diagrams/:lessonId/:ref answers an image one of those diagrams shows.

import Type from "typebox";
import { BadRequest, jsonBody, parse, stillBuilding } from "../../clock/http.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError, type Store } from "../../store/store.ts";
import { type DiagramsBuilder, DiagramsConflict, diagramImage } from "./diagrams.ts";

const Empty = Type.Object({}, { additionalProperties: false });

// A lesson's diagrams are made once at a time; another lesson's may be made meanwhile.
const busy = new Set<string>();

export async function diagramsResponse(
  request: Request,
  sessionId: string,
  lessonId: string,
  builder: DiagramsBuilder,
): Promise<Response> {
  const key = `${sessionId}:${lessonId}`;
  if (busy.has(key)) return stillBuilding("This lesson's diagrams are still being made");
  busy.add(key);
  try {
    parse(Empty, await jsonBody(request));
    return Response.json({ diagrams: await builder.build(lessonId) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof BadRequest) return Response.json({ error }, { status: e.status });
    if (e instanceof InvalidNameError) return Response.json({ error }, { status: 400 });
    if (e instanceof DiagramsConflict) return Response.json({ error }, { status: 409 });
    // The diagrams agent failed its step twice; the trace has why.
    if (e instanceof StepFailed) return Response.json({ error }, { status: 502 });
    throw e;
  } finally {
    busy.delete(key);
  }
}

export function diagramImageResponse(
  store: Store,
  sessionId: string,
  lessonId: string,
  ref: string,
): Response {
  try {
    const image = diagramImage(store, sessionId, lessonId, ref);
    if (!image) return Response.json({ error: "No such diagram image" }, { status: 404 });
    // A blob is named by its content's hash, so the bytes behind a ref never change.
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "content-type": image.mime,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    if (e instanceof InvalidNameError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
