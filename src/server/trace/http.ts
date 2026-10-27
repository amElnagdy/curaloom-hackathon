// HTTP views of a session's trace for the UI's trace panel: a JSON page and an SSE stream.

import type { Store } from "../store/store.ts";
import type { TraceEvent } from "./trace.ts";

function invalid(error: unknown): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 },
  );
}

export function traceJson(store: Store, sessionId: string, after: string | null): Response {
  try {
    return Response.json({ events: store.readTrace<TraceEvent>(sessionId, after ?? undefined) });
  } catch (e) {
    return invalid(e);
  }
}

// Sends every event after `after` (or the Last-Event-ID a reconnecting EventSource sends), then
// polls the store for new events until the client disconnects.
export function traceStream(
  store: Store,
  sessionId: string,
  after: string | null,
  { signal, pollMs = 500 }: { signal: AbortSignal; pollMs?: number },
): Response {
  try {
    store.readTrace(sessionId);
  } catch (e) {
    return invalid(e);
  }
  const encoder = new TextEncoder();
  let cursor = after ?? undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const flush = () => {
        if (signal.aborted) return;
        for (const event of store.readTrace<TraceEvent>(sessionId, cursor)) {
          controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));
          cursor = event.id;
        }
        timer = setTimeout(flush, pollMs);
      };
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        controller.close();
      });
      flush();
    },
    cancel() {
      clearTimeout(timer);
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
