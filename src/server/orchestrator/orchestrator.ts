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

// The Arabic name of a step, for the trace's Arabic summaries. A key holds run ids, lesson ids and
// hashes, which the English summary keeps and the Arabic one does not. One entry per key an agent
// passes to runStep; any other key is "the step", and the drawer names its agent beside it.
const STEP_NAMES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^intake:[^:]+:message:(\d+):/, (m) => `الرد على رسالتك رقم ${m[1]}`],
  [/^intake:[^:]+:diagnostic$/, () => "كتابة أسئلة الاختبار القصير"],
  [/^intake:[^:]+:profile$/, () => "بناء ملفك التعليمي"],
  [/^scout:/, () => "البحث عن مصادر مفتوحة الترخيص"],
  [/^architect:/, () => "تصميم خطة دورتك"],
  [/^replan:v(\d+):/, (m) => `شرح النسخة ${m[1]} المقترحة من خطتك`],
  [/^lesson:L(\d+):/, (m) => `كتابة الدرس ${m[1]}`],
  [/^quiz:L(\d+):/, (m) => `كتابة اختبار الدرس ${m[1]}`],
  [/^grade:q_L(\d+)_/, (m) => `تصحيح محاولتك في اختبار الدرس ${m[1]}`],
  [/^diagrams:L(\d+):/, (m) => `إعداد رسم الدرس ${m[1]}`],
  [/^coach:[a-z]+_a\d+_d(\d+):/, (m) => `صياغة رسالة المدرب لليوم ${m[1]}`],
];

function stepName(key: string): string {
  for (const [pattern, name] of STEP_NAMES) {
    const match = pattern.exec(key);
    if (match) return `خطوة ${name(match)}`;
  }
  return "الخطوة";
}

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
    const readState = () => store.readDoc<SessionState>(sessionId, SESSION_DOC) ?? { steps: {} };
    const state = readState();
    const record = (step: StepRecord) => {
      const now = readState();
      store.writeDoc(sessionId, SESSION_DOC, { ...now, steps: { ...now.steps, [key]: step } });
    };
    const emit = (event: Omit<TraceInput, "agent">) => tracer.emit({ agent: agent.name, ...event });
    const step = stepName(key);

    const done = state.steps[key];
    if (done?.status === "done") {
      emit({
        kind: "decision",
        summary_ar: `${step} مكتملة من قبل، فتُستأنف بنتيجتها المحفوظة`,
        summary_en: `Step ${key} already done; resuming with its saved output`,
        payload_ref: done.output_ref,
      });
      return store.readBlob<Static<S>>(sessionId, done.output_ref);
    }

    emit({
      kind: "decision",
      summary_ar: `بدأت ${step}`,
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
        summary_ar: `نتيجة ${step} غير صالحة، فيعيد المحاولة مرة واحدة`,
        summary_en: `${key} attempt 1 failed; retrying once: ${result.errors.join("; ")}`,
      });
      result = await attempt(result.errors);
    }
    if (result.errors.length) {
      const reason = result.errors.join("; ");
      emit({
        kind: "error",
        summary_ar: `فشلت ${step} بعد إعادة المحاولة`,
        summary_en: `${key} attempt 2 failed; giving up: ${reason}`,
      });
      record({ status: "failed", error: reason });
      throw new StepFailed(`Step ${key} failed: ${reason}`);
    }

    const ref = store.writeBlob(sessionId, result.output);
    emit({
      kind: "output",
      summary_ar: `نتيجة ${step} مطابقة للعقد`,
      summary_en: `${key} output matches its contract`,
      payload_ref: ref,
    });
    record({ status: "done", output_ref: ref });
    return result.output as Static<S>;
  }

  return { runStep };
}
