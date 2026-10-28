// Trace events (#13): one per model call, tool call, decision, output or error, with Arabic and
// English summaries. Large payloads go to a blob and the event keeps only `payload_ref`.

import { config } from "../../config.ts";
import { readSimNow, wallNow } from "../clock/clock.ts";
import { formatSimTime, type SimTime } from "../clock/time.ts";
import type { ProviderTraceEvent } from "../providers/provider.ts";
import type { Store } from "../store/store.ts";

export type TraceKind = "tool_call" | "model_call" | "decision" | "output" | "error";

export type TraceEvent = {
  id: string;
  session_id: string;
  ts: string;
  sim_ts: string | null;
  agent: string;
  kind: TraceKind;
  summary_ar: string;
  summary_en: string;
  model?: string;
  cost_usd?: number;
  // Session total so far, on every event that has a cost.
  total_cost_usd?: number;
  latency_ms?: number;
  payload_ref?: string;
};

export type TraceInput = Omit<
  TraceEvent,
  "id" | "session_id" | "ts" | "sim_ts" | "total_cost_usd"
> & {
  // When, in simulated time, the event happened, if not now: e.g. a coach rule that a jump of the
  // clock caught up on.
  at?: SimTime;
};

export type Tracer = {
  emit(event: TraceInput): TraceEvent;
  fromProvider(event: ProviderTraceEvent): TraceEvent;
};

// Wall time for `ts`, simulated time for `sim_ts` (null while SIM_CLOCK is off).
export type TraceClock = { wall(): Date; sim(): SimTime | null };

export function sessionClock(store: Store, sessionId: string): TraceClock {
  return {
    wall: wallNow,
    sim: () => (config.simClock ? readSimNow(store, sessionId) : null),
  };
}

// Ids and the cost total continue from the stored trace, read again on every emit, so tracers in
// different requests of one process (a dummy run, a clock jump) never reuse an id.
export function createTracer(
  store: Store,
  sessionId: string,
  clock: TraceClock = sessionClock(store, sessionId),
): Tracer {
  const emit = ({ at, ...event }: TraceInput): TraceEvent => {
    const existing = store.readTrace<TraceEvent>(sessionId);
    const sim = at ?? clock.sim();
    const full: TraceEvent = {
      id: `evt_${String(existing.length + 1).padStart(4, "0")}`,
      session_id: sessionId,
      ts: clock.wall().toISOString(),
      sim_ts: sim ? formatSimTime(sim) : null,
      ...event,
    };
    if (event.cost_usd !== undefined) {
      full.total_cost_usd = existing.reduce((sum, e) => sum + (e.cost_usd ?? 0), event.cost_usd);
    }
    store.appendTrace(sessionId, full);
    return full;
  };

  return {
    emit,
    fromProvider: (e) =>
      emit({
        agent: e.agent,
        kind: e.ok ? "model_call" : "error",
        summary_ar: e.ok
          ? e.summary_ar
          : `فشل استدعاء النموذج (محاولة ${e.attempt}): ${e.summary_ar}`,
        summary_en: e.ok
          ? e.summary_en
          : `Model call failed (attempt ${e.attempt}): ${e.summary_en}: ${e.error}`,
        model: e.model,
        cost_usd: e.cost_usd,
        latency_ms: e.latency_ms,
      }),
  };
}
