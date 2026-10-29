// Runs named agents as steps over a persistent session (#13). Each step's output is validated
// against its contract; an invalid output (or a throw) gets exactly one retry with the errors as
// feedback, then a visible error event. Finished steps are recorded, so a reloaded session resumes.

import type { Static, TSchema } from "typebox";
import { contractErrors } from "../../../contracts/index.ts";
import type { Provider, ProviderTraceEvent } from "../providers/provider.ts";
import type { Store } from "../store/store.ts";
import { createTracer, type TraceClock, type TraceInput, type Tracer } from "../trace/trace.ts";

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

// A model prompt for an agent: on the orchestrator's retry, it says why the last attempt failed.
export const withFeedback = (ctx: AgentContext, input: string) =>
  ctx.feedback ? `${input}\n\nThe previous attempt failed: ${ctx.feedback.join("; ")}` : input;

export type OrchestratorOptions = {
  store: Store;
  makeProvider(onTrace: (event: ProviderTraceEvent) => void): Provider;
  clock?: TraceClock;
};

const SESSION_DOC = "session";

export function createOrchestrator({ store, makeProvider, clock }: OrchestratorOptions) {
  const tracers = new Map<string, Tracer>();
  const tracerFor = (sessionId: string) => {
    let tracer = tracers.get(sessionId);
    if (!tracer) {
      tracer = createTracer(store, sessionId, clock);
      tracers.set(sessionId, tracer);
    }
    return tracer;
  };

  // `key` names the step in the session (default: the agent's name). Give an agent that runs more
  // than once per session a key per run, e.g. "lesson:L2" or "coach:day5".
  async function runStep<I, S extends TSchema>(
    sessionId: string,
    agent: Agent<I, S>,
    input: I,
    { key = agent.name }: { key?: string } = {},
  ): Promise<Static<S>> {
    const tracer = tracerFor(sessionId);
    const state = store.readDoc<SessionState>(sessionId, SESSION_DOC) ?? { steps: {} };
    const record = (step: StepRecord) => {
      state.steps[key] = step;
      store.writeDoc(sessionId, SESSION_DOC, state);
    };
    const emit = (event: Omit<TraceInput, "agent">) => tracer.emit({ agent: agent.name, ...event });

    const done = state.steps[key];
    if (done?.status === "done") {
      emit({
        kind: "decision",
        summary_ar: "الخطوة مكتملة من قبل؛ استئناف بنتيجتها المحفوظة",
        summary_en: `Step ${key} already done; resuming with its saved output`,
        payload_ref: done.output_ref,
      });
      return store.readBlob<Static<S>>(sessionId, done.output_ref);
    }

    emit({
      kind: "decision",
      summary_ar: `بدء خطوة ${key}`,
      summary_en: `Starting step ${key}`,
    });
    const provider = makeProvider((event) => tracer.fromProvider(event));
    const attempt = async (feedback: string[] | null) => {
      try {
        const output = await agent.run(
          { sessionId, store, provider, trace: emit, feedback },
          input,
        );
        return { output, errors: contractErrors(agent.output, output) };
      } catch (e) {
        return { output: undefined, errors: [e instanceof Error ? e.message : String(e)] };
      }
    };

    let result = await attempt(null);
    if (result.errors.length) {
      emit({
        kind: "error",
        summary_ar: `نتيجة ${key} غير صالحة؛ إعادة المحاولة مرة واحدة`,
        summary_en: `${key} attempt 1 failed; retrying once: ${result.errors.join("; ")}`,
      });
      result = await attempt(result.errors);
    }
    if (result.errors.length) {
      const reason = result.errors.join("; ");
      emit({
        kind: "error",
        summary_ar: `فشلت خطوة ${key} بعد إعادة المحاولة`,
        summary_en: `${key} attempt 2 failed; giving up: ${reason}`,
      });
      record({ status: "failed", error: reason });
      throw new StepFailed(`Step ${key} failed: ${reason}`);
    }

    const ref = store.writeBlob(sessionId, result.output);
    emit({
      kind: "output",
      summary_ar: `نتيجة ${key} مطابقة للعقد`,
      summary_en: `${key} output matches its contract`,
      payload_ref: ref,
    });
    record({ status: "done", output_ref: ref });
    return result.output as Static<S>;
  }

  return { runStep };
}
