// HTTP views of a session's simulated time and phone: POST /api/sessions/:id/sim/{advance,set,reset},
// each answering {now, events} with the coach events the move fired, POST
// /api/sessions/:id/inbox {text} or {event_id, choice, pause_days?}, the learner's reply or their
// tap on a check-in's button (#25), answering {opted_out, confirmed, answer}, and POST
// /api/sessions/:id/consent, the consent screen's save (#24), answering {consent}.

import Type, { type Static, type TSchema } from "typebox";
import { CheckinReply, Consent, contractErrors } from "../../../contracts/index.ts";
import { CheckinConflict } from "../coach/coach.ts";
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

export class BadRequest extends Error {}

// A 409 that clears by waiting: another request is still building what this one asks for. The page
// asks again after Retry-After; a 409 without it, such as one before there is a plan, does not clear.
export const stillBuilding = (error: string) =>
  Response.json({ error }, { status: 409, headers: { "retry-after": "3" } });

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
// another site is refused, and the body must be typed as JSON: a cross-site form or a no-cors fetch
// cannot send that type without a preflight, which these routes never answer.
export async function jsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new BadRequest("Requests from another site are refused");
  }
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type))
    throw new BadRequest("Body must be sent as application/json");
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Body must be JSON");
  }
}

// 409 for a clock move into the past or a tap on a message the learner cannot answer, 400 for a bad
// body or session id.
async function answer(work: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (e) {
    if (e instanceof ClockError || e instanceof CheckinConflict) {
      return Response.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof BadRequest || e instanceof InvalidNameError) {
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
