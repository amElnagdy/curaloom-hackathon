// HTTP views of a session's simulated time and phone: POST /api/sessions/:id/sim/{advance,set,reset},
// each answering {now, events} with the coach events the move fired, POST
// /api/sessions/:id/inbox {text} or {event_id, choice, pause_days?}, the learner's reply or their
// tap on a check-in's button (#25), answering {opted_out, confirmed, answer}, POST
// /api/sessions/:id/consent, the consent screen's save (#24), answering {consent}, and POST
// /api/sessions/:id/comeback/{open,recap,replan}, the steps of the learner's return (#27),
// answering {comeback}, and with recap or replan the proposal as {replanned} too.

import Type, { type Static, type TSchema } from "typebox";
import { CheckinReply, Consent, contractErrors } from "../../../contracts/index.ts";
import { AttemptInvalid } from "../agents/examiner/examiner.ts";
import { CheckinConflict, ComebackConflict } from "../coach/coach.ts";
import { InvalidNameError } from "../store/store.ts";
import { ClockError } from "./clock.ts";
import type { createSim, SimResult } from "./sim.ts";

const Advance = Type.Object(
  {
    days: Type.Optional(Type.Integer({ minimum: 0 })),
    minutes: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
const SetDay = Type.Object({ day: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
const Empty = Type.Object({}, { additionalProperties: false });
const Reply = Type.Union([
  Type.Object(
    { text: Type.String({ maxLength: 1000, pattern: "\\S" }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      event_id: Type.String({ maxLength: 64 }),
      choice: CheckinReply.properties.choice,
      pause_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
    },
    { additionalProperties: false },
  ),
]);
const PAUSE_DAYS = 7;
// The recap's answers, in the body the quiz page sends for a lesson's attempt.
const RecapBody = Type.Object(
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

const HHMM = Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" });
const ConsentBody = Type.Object(
  {
    messages: Type.Boolean(),
    quiet_hours: Type.Union([
      Type.Object({ start: HHMM, end: HHMM }, { additionalProperties: false }),
      Type.Null(),
    ]),
    intensity: Consent.properties.intensity,
  },
  { additionalProperties: false },
);

// A request the route refuses before any work: 400, or 413 for a body over its cap.
export class BadRequest extends Error {
  status: 400 | 413;

  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.status = status;
  }
}

// A 202 that clears by waiting: another request is still building what this one asks for. The page
// asks again after Retry-After. A 409, such as one before there is a plan, does not clear.
export const stillBuilding = (error: string) =>
  Response.json({ error }, { status: 202, headers: { "retry-after": "3" } });

export function parse<S extends TSchema>(schema: S, value: unknown): Static<S> {
  const errors = contractErrors(schema, value);
  if (errors.length) throw new BadRequest(`Invalid body: ${errors.join("; ")}`);
  return value as Static<S>;
}

type Sim = ReturnType<typeof createSim>;

const ACTIONS: Record<string, (sim: Sim, body: unknown) => Promise<SimResult>> = {
  advance: (sim, body) => sim.advance(parse(Advance, body)),
  set: (sim, body) => sim.set(parse(SetDay, body).day),
  reset: async (sim, body) => {
    parse(Empty, body);
    return sim.reset();
  },
};

// Every state-changing route reads its body here. There are no accounts yet, so a request from
// another site is refused, and the body must be typed as JSON or WAV audio: a cross-site form or a
// no-cors fetch cannot send either type without a preflight, which these routes never answer.
// Nothing in front of the app limits a body, so one over its kind's cap is refused before it is read.
type BodyKind = { type: RegExp; typeError: string; maxBytes: number; tooLarge: string };

const JSON_BODY: BodyKind = {
  type: /^application\/json\b/i,
  typeError: "Body must be sent as application/json",
  // The largest is a quiz attempt: 20 answers of 2,000 characters, about 80 KB of Arabic.
  maxBytes: 128 * 1024,
  tooLarge: "Body must be 128 KB or less",
};

// The intake's voice message (#37): the page stops recording at a minute, 1.92 MB at 16 kHz.
const AUDIO_BODY: BodyKind = {
  type: /^audio\/wav\b/i,
  typeError: "Body must be sent as audio/wav",
  maxBytes: 2 * 1024 * 1024,
  tooLarge: "Audio must be 2 MB or less, about a minute",
};

export async function jsonBody(request: Request): Promise<unknown> {
  const text = new TextDecoder().decode(await cappedBody(request, JSON_BODY));
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Body must be JSON");
  }
}

export const audioBody = (request: Request): Promise<Uint8Array> => cappedBody(request, AUDIO_BODY);

// A content-length over the cap is refused unread. Any other body is read only until it passes the
// cap, so a missing or false length gets no more through; leaving the loop cancels the stream.
async function cappedBody(request: Request, kind: BodyKind): Promise<Uint8Array> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new BadRequest("Requests from another site are refused");
  }
  if (!kind.type.test(request.headers.get("content-type") ?? "")) {
    throw new BadRequest(kind.typeError);
  }
  if (Number(request.headers.get("content-length")) > kind.maxBytes) {
    throw new BadRequest(kind.tooLarge, 413);
  }
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request.body) {
    bytes += chunk.byteLength;
    if (bytes > kind.maxBytes) throw new BadRequest(kind.tooLarge, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// 409 for a clock move into the past, a tap on a message the learner cannot answer or a comeback
// step with none to take, 400 for a bad body, recap answers or session id, 413 for a body too large.
async function answer(work: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (e) {
    if (e instanceof ClockError || e instanceof CheckinConflict || e instanceof ComebackConflict) {
      return Response.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof InvalidNameError || e instanceof AttemptInvalid) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

// `sim` builds the session's sim for one request, so a bad session id is a 400 like any other.
export type SimDeps = { sim(sessionId: string): Sim; enabled: boolean };

const chains = new Map<string, Promise<unknown>>();

// Runs one session's sim, reply and consent requests one after another. A move awaits each coach
// message as it is written, and a second move in between would read the fired-rule ledger before
// the first one writes it. In-process only; the outbox's dedupe by message id is the second guard.
function serial<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const result = (chains.get(sessionId) ?? Promise.resolve()).then(work);
  const settled = result.catch(() => undefined);
  chains.set(sessionId, settled);
  void settled.then(() => {
    if (chains.get(sessionId) === settled) chains.delete(sessionId);
  });
  return result;
}

export async function simResponse(
  request: Request,
  sessionId: string,
  action: string,
  { sim, enabled }: SimDeps,
): Promise<Response> {
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!enabled || !run) return new Response(null, { status: 404 });
  return answer(async () => {
    const body = await jsonBody(request);
    return serial(sessionId, () => run(sim(sessionId), body));
  });
}

export function inboxResponse(
  request: Request,
  sessionId: string,
  { sim }: Omit<SimDeps, "enabled">,
): Promise<Response> {
  return answer(async () => {
    const body = parse(Reply, await jsonBody(request));
    return serial(sessionId, async () => {
      if ("text" in body) return { ...sim(sessionId).reply(body.text), answer: null };
      const { event_id, choice, pause_days = PAUSE_DAYS } = body;
      const answered = await sim(sessionId).answer({ event_id, choice, pause_days });
      return { opted_out: false, confirmed: false, answer: answered };
    });
  });
}

export function consentResponse(
  request: Request,
  sessionId: string,
  { sim }: Omit<SimDeps, "enabled">,
): Promise<Response> {
  return answer(async () => {
    const choice = parse(ConsentBody, await jsonBody(request));
    if (choice.quiet_hours && choice.quiet_hours.start === choice.quiet_hours.end) {
      throw new BadRequest("Quiet hours must end at a different time than they start");
    }
    return { consent: await serial(sessionId, async () => sim(sessionId).setConsent(choice)) };
  });
}

// `open` records the learner's return when the plan page sees them back, once per ladder; `recap`
// takes their recap answers and `replan` stands in for it while no lesson is passed. Both finish
// the comeback with the re-plan's proposal, so they run in series with the session's clock moves.
const COMEBACK: Record<string, (sim: Sim, body: unknown) => Promise<unknown>> = {
  open: async (sim, body) => {
    parse(Empty, body);
    const comeback = sim.detectComeback();
    if (comeback.state === "none") throw new ComebackConflict("No comeback is due");
    return { comeback };
  },
  recap: (sim, body) => sim.finishComeback(parse(RecapBody, body)),
  replan: async (sim, body) => {
    parse(Empty, body);
    return sim.finishComeback(null);
  },
};

export function comebackResponse(
  request: Request,
  sessionId: string,
  action: string,
  { sim }: Omit<SimDeps, "enabled">,
): Promise<Response> {
  const run = Object.hasOwn(COMEBACK, action) ? COMEBACK[action] : undefined;
  if (!run) return Promise.resolve(new Response(null, { status: 404 }));
  return answer(async () => {
    const body = await jsonBody(request);
    return serial(sessionId, () => run(sim(sessionId), body));
  });
}
