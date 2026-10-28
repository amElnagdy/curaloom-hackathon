import { after } from "next/server";
import { DEMO_SESSION_ID } from "../../../../../demo/session.ts";
import { config } from "../../../../config.ts";
import { createDummyRunner } from "../../../../server/demo/dummy-run.ts";

const runner = createDummyRunner();

// The body is optional: {"sessionId": "<id>"}, defaulting to the demo session.
async function sessionIdFrom(request: Request): Promise<string> {
  const text = await request.text();
  if (!text.trim()) return DEMO_SESSION_ID;
  const body: unknown = JSON.parse(text);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error('Body must be a JSON object such as {"sessionId": "demo"}');
  }
  const { sessionId = DEMO_SESSION_ID } = body as { sessionId?: unknown };
  if (typeof sessionId !== "string") throw new Error("sessionId must be a string");
  return sessionId;
}

// POST /api/dev/dummy-run — starts the dummy agent (#15) for a session and answers 202 at once;
// its trace events reach the trace drawer through the trace stream. 409 while that session
// already has a run, 404 in production.
export async function POST(request: Request) {
  if (!config.devTools) return new Response(null, { status: 404 });

  let sessionId: string;
  let run: ReturnType<typeof runner.start>;
  try {
    sessionId = await sessionIdFrom(request);
    run = runner.start(sessionId);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (!run) {
    return Response.json(
      { error: `A dummy run is already running for session ${sessionId}`, sessionId },
      { status: 409 },
    );
  }

  after(
    run.then((outcome) => {
      if (outcome.status === "failed") {
        console.error(`Dummy run ${outcome.key} in session ${sessionId} failed: ${outcome.error}`);
      }
    }),
  );
  return Response.json({ sessionId }, { status: 202 });
}
