// Runs named agents as steps over a persistent session (#13). Each step's output is validated
// against its contract; an invalid output (or a throw) gets exactly one retry with the errors as
// feedback, then a visible error event. Finished steps are recorded, so a reloaded session resumes.

import type { Static, TSchema } from "typebox";
import { contractErrors } from "../../../contracts/index.ts";
import type { Provider, ProviderTraceEvent } from "../providers/provider.ts";
import type { Store } from "../store/store.ts";
import { createTracer, type TraceInput, type Tracer } from "../trace/trace.ts";

export type AgentContext = {
  sessionId: string;
  store: Store;
  provider: Provider;
  trace(event: Omit<TraceInput, "agent">): void;
  // Contract errors from the previous attempt, or null on the first attempt.
  feedback: string[] | null;
};

export type Agent<I, S extends TSchema> = {
  name: string;
  output: S;
  run(ctx: AgentContext, input: I): Promise<unknown>;
};

type StepRecord = { status: "done"; output_ref: string } | { status: "failed"; error: string };
type SessionState = { steps: Record<string, StepRecord> };

export class StepFailed extends Error {}

export type OrchestratorOptions = {
  store: Store;
  makeProvider(onTrace: (event: ProviderTraceEvent) => void): Provider;
  now?: () => Date;
};

const SESSION_DOC = "session";

export function createOrchestrator({ store, makeProvider, now }: OrchestratorOptions) {
  const tracers = new Map<string, Tracer>();
  const tracerFor = (sessionId: string) => {
    let tracer = tracers.get(sessionId);
    if (!tracer) {
      tracer = createTracer(store, sessionId, now);
      tracers.set(sessionId, tracer);
    }
    return tracer;
  };

  async function runStep<I, S extends TSchema>(
    sessionId: string,
    agent: Agent<I, S>,
    input: I,
  ): Promise<Static<S>> {
    const tracer = tracerFor(sessionId);
    const state = store.readDoc<SessionState>(sessionId, SESSION_DOC) ?? { steps: {} };
    const record = (step: StepRecord) => {
      state.steps[agent.name] = step;
      store.writeDoc(sessionId, SESSION_DOC, state);
    };
    const emit = (event: Omit<TraceInput, "agent">) => tracer.emit({ agent: agent.name, ...event });

    const done = state.steps[agent.name];
    if (done?.status === "done") {
      emit({
        kind: "decision",
        summary_ar: "الخطوة مكتملة من قبل؛ استئناف بنتيجتها المحفوظة",
        summary_en: `Step ${agent.name} already done; resuming with its saved output`,
        payload_ref: done.output_ref,
      });
      return store.readBlob<Static<S>>(sessionId, done.output_ref);
    }

    emit({
      kind: "decision",
      summary_ar: `بدء خطوة ${agent.name}`,
      summary_en: `Starting step ${agent.name}`,
    });
    const provider = makeProvider((event) => tracer.fromProvider(event));
    let feedback: string[] | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let errors: string[];
      try {
        const output = await agent.run(
          { sessionId, store, provider, trace: emit, feedback },
          input,
        );
        errors = contractErrors(agent.output, output);
        if (errors.length === 0) {
          const ref = store.writeBlob(sessionId, output);
          emit({
            kind: "output",
            summary_ar: `نتيجة ${agent.name} مطابقة للعقد`,
            summary_en: `${agent.name} output matches its contract`,
            payload_ref: ref,
          });
          record({ status: "done", output_ref: ref });
          return output as Static<S>;
        }
      } catch (e) {
        errors = [e instanceof Error ? e.message : String(e)];
      }
      const last = attempt === 2;
      emit({
        kind: "error",
        summary_ar: last
          ? `فشلت خطوة ${agent.name} بعد إعادة المحاولة`
          : `نتيجة ${agent.name} غير صالحة؛ إعادة المحاولة مرة واحدة`,
        summary_en: `${agent.name} attempt ${attempt} failed${last ? "; giving up" : "; retrying once"}: ${errors.join("; ")}`,
      });
      if (last) {
        record({ status: "failed", error: errors.join("; ") });
        throw new StepFailed(`Step ${agent.name} failed: ${errors.join("; ")}`);
      }
      feedback = errors;
    }
    throw new Error("unreachable");
  }

  return { runStep };
}
