// HTTP view of a session's simulated time: POST /api/sessions/:id/sim/{advance,set,reset}, each
// answering {now, events} with the coach events the move fired.

import Type, { type Static, type TSchema } from "typebox";
import { contractErrors } from "../../../contracts/index.ts";
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

class BadRequest extends Error {}

function parse<S extends TSchema>(schema: S, value: unknown): Static<S> {
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

async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Body must be JSON");
  }
}

export type SimDeps = { store: Store; seed: SimSeed; enabled: boolean };

export async function simResponse(
  request: Request,
  sessionId: string,
  action: string,
  { store, seed, enabled }: SimDeps,
): Promise<Response> {
  const run = ACTIONS[action];
  if (!enabled || !run) return new Response(null, { status: 404 });
  try {
    const body = await jsonBody(request);
    return Response.json(run(createSim({ store, sessionId, seed }), body));
  } catch (e) {
    if (e instanceof ClockError) return Response.json({ error: e.message }, { status: 409 });
    if (e instanceof BadRequest || e instanceof InvalidNameError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
