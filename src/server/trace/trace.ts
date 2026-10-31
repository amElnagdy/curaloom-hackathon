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
  // A model call's role in config/models.yaml, and the model that served it.
  role?: string;
  model?: string;
  cost_usd?: number;
  // Session total so far, on every event that has a cost.
  total_cost_usd?: number;
  latency_ms?: number;
  payload_ref?: string;
  // The hash of a request replay has no recording for (#30): the shell shows it as an alert.
  missing_recording?: string;
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

type Tally = { count: number; total: number };

// One tally per session per store, shared by every tracer in the process, so tracers in different
// requests (a dummy run, a clock jump) never reuse an id. It is read from the stored trace once,
// and again after the trace is deleted under the server (`pnpm demo:reset`).
const tallies = new WeakMap<Store, Map<string, Tally>>();

function tallyOf(store: Store, sessionId: string): Tally {
  let sessions = tallies.get(store);
  if (!sessions) {
    sessions = new Map();
    tallies.set(store, sessions);
  }
  let tally = sessions.get(sessionId);
  if (!tally || !store.hasTrace(sessionId)) {
    const existing = store.readTrace<TraceEvent>(sessionId);
    tally = {
      count: existing.length,
      total: existing.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0),
    };
    sessions.set(sessionId, tally);
  }
  return tally;
}

export function createTracer(
  store: Store,
  sessionId: string,
  clock: TraceClock = sessionClock(store, sessionId),
): Tracer {
  const emit = ({ at, ...event }: TraceInput): TraceEvent => {
    const tally = tallyOf(store, sessionId);
    const sim = at ?? clock.sim();
    tally.count++;
    const full: TraceEvent = {
      id: `evt_${String(tally.count).padStart(4, "0")}`,
      session_id: sessionId,
      ts: clock.wall().toISOString(),
      sim_ts: sim ? formatSimTime(sim) : null,
      ...event,
    };
    if (event.cost_usd !== undefined) {
      tally.total += event.cost_usd;
      full.total_cost_usd = tally.total;
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
          : e.missing_recording
            ? `لا تسجيل لهذا الطلب (${e.missing_recording}): ${e.summary_ar}`
            : `فشل استدعاء النموذج (محاولة ${e.attempt}): ${e.summary_ar}`,
        summary_en: e.ok
          ? e.summary_en
          : `Model call failed (attempt ${e.attempt}): ${e.summary_en}: ${e.error}`,
        role: e.role,
        model: e.model,
        cost_usd: e.cost_usd,
        latency_ms: e.latency_ms,
        ...(e.missing_recording && { missing_recording: e.missing_recording }),
      }),
  };
}
