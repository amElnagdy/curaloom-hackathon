// Trace events (#13): one per model call, tool call, decision, output or error, with Arabic and
// English summaries. Large payloads go to a blob and the event keeps only `payload_ref`.

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
  latency_ms?: number;
  payload_ref?: string;
};

export type TraceInput = Omit<TraceEvent, "id" | "session_id" | "ts" | "sim_ts">;

export type Tracer = {
  emit(event: TraceInput): TraceEvent;
  fromProvider(event: ProviderTraceEvent): TraceEvent;
};

// `now` is injected. The default reads the system clock: a known exception to ADR-004 until the
// clock module (#23) exists, which will also fill `sim_ts`.
export function createTracer(store: Store, sessionId: string, now = () => new Date()): Tracer {
  let count = store.readTrace(sessionId).length;

  const emit = (event: TraceInput): TraceEvent => {
    count++;
    const full: TraceEvent = {
      id: `evt_${String(count).padStart(4, "0")}`,
      session_id: sessionId,
      ts: now().toISOString(),
      sim_ts: null,
      ...event,
    };
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
