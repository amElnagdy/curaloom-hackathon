// HTTP views of a session's simulated time and phone: POST /api/sessions/:id/sim/{advance,set,reset},
// each answering {now, events} with the coach events the move fired, POST
// /api/sessions/:id/inbox {text}, the learner's reply, answering {opted_out, confirmed}, and POST
// /api/sessions/:id/consent, the consent screen's save (#24), answering {consent}.

import Type, { type Static, type TSchema } from "typebox";
import { Consent, contractErrors } from "../../../contracts/index.ts";
import { sessionSimSeed } from "../coach/session.ts";
import { InvalidNameError, type Store } from "../store/store.ts";
import { ClockError } from "./clock.ts";
import { createSim, type SimResult, type SimSeed } from "./sim.ts";

const Advance = Type.Object(
  {
    days: Type.Optional(Type.Integer({ minimum: 0 })),
    minutes: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
const SetDay = Type.Object({ day: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
const Empty = Type.Object({}, { additionalProperties: false });
const Reply = Type.Object(
  { text: Type.String({ maxLength: 1000, pattern: "\\S" }) },
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

const ACTIONS: Record<string, (sim: Sim, body: unknown) => SimResult> = {
  advance: (sim, body) => sim.advance(parse(Advance, body)),
  set: (sim, body) => sim.set(parse(SetDay, body).day),
  reset: (sim, body) => {
    parse(Empty, body);
    return sim.reset();
  },
};

export async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Body must be JSON");
  }
}

// 409 for a clock move into the past, 400 for a bad body or session id.
async function answer(work: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (e) {
    if (e instanceof ClockError) return Response.json({ error: e.message }, { status: 409 });
    if (e instanceof BadRequest || e instanceof InvalidNameError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

// `seed` is the demo's seed; each handler turns it into the session's (sessionSimSeed), so a bad
// session id is a 400 like any other.
export type SimDeps = { store: Store; seed: SimSeed; enabled: boolean };

const sessionSimFor = (sessionId: string, { store, seed }: Omit<SimDeps, "enabled">) =>
  createSim({ store, sessionId, seed: sessionSimSeed(store, sessionId, seed) });

export async function simResponse(
  request: Request,
  sessionId: string,
  action: string,
  { store, seed, enabled }: SimDeps,
): Promise<Response> {
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!enabled || !run) return new Response(null, { status: 404 });
  return answer(async () =>
    run(sessionSimFor(sessionId, { store, seed }), await jsonBody(request)),
  );
}

export function inboxResponse(
  request: Request,
  sessionId: string,
  deps: Omit<SimDeps, "enabled">,
): Promise<Response> {
  return answer(async () => {
    const { text } = parse(Reply, await jsonBody(request));
    return sessionSimFor(sessionId, deps).reply(text);
  });
}

export function consentResponse(
  request: Request,
  sessionId: string,
  deps: Omit<SimDeps, "enabled">,
): Promise<Response> {
  return answer(async () => {
    const choice = parse(ConsentBody, await jsonBody(request));
    if (choice.quiet_hours && choice.quiet_hours.start === choice.quiet_hours.end) {
      throw new BadRequest("Quiet hours must end at a different time than they start");
    }
    return { consent: sessionSimFor(sessionId, deps).setConsent(choice) };
  });
}
