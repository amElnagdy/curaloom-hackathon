// Dev-only dummy run (#15): a scripted agent that emits about 10 seconds of trace events with no
// model calls, so the trace drawer and the activity feed can be checked live. Its first attempt
// returns an output that breaks its contract, so the orchestrator's real retry shows in the trace.

import Type, { type Static } from "typebox";
import { type Agent, type AgentContext, createOrchestrator } from "../orchestrator/orchestrator.ts";
import type { Provider } from "../providers/provider.ts";
import { createFileStore, type Store } from "../store/store.ts";
import type { TraceClock, TraceInput } from "../trace/trace.ts";

// A dummy result is not a domain entity, so its contract lives here, not in contracts/index.ts
// (ADR-006 covers the entities agents exchange).
const DummyOutput = Type.Object(
  { checked: Type.Integer(), accepted: Type.Integer(), note_ar: Type.String() },
  { additionalProperties: false },
);
export type DummyOutput = Static<typeof DummyOutput>;

type Sleep = (ms: number) => Promise<void>;
// `ms` is the pause before the event; a tool call reports it as its latency.
type ScriptStep = { ms: number } & Omit<TraceInput, "agent" | "latency_ms">;

const FIRST_ATTEMPT: ScriptStep[] = [
  {
    ms: 800,
    kind: "decision",
    summary_ar: "بدأ تشغيلًا تجريبيًا بأحداث مكتوبة مسبقًا، ولا يستدعي أي نموذج",
    summary_en: "Dummy run: scripted events, no model calls",
  },
  {
    ms: 1400,
    kind: "tool_call",
    summary_ar: "بحث تجريبي عن مصادر مفتوحة الترخيص بأربع لغات",
    summary_en: "fake_search: open-licence sources in en, ru, zh, fr",
  },
  {
    ms: 1400,
    kind: "tool_call",
    summary_ar: "فتح ٣ صفحات تجريبية وقرأ بيانات الترخيص فيها",
    summary_en: "fake_open_page: 3 sample pages on example.org",
  },
  {
    ms: 1200,
    kind: "tool_call",
    summary_ar: "تحقّق الكود من التراخيص: قبل مصدرين، ورفض مصدرًا صفحته تقول «جميع الحقوق محفوظة»",
    summary_en: "licence_check: 2 accepted, 1 rejected (all rights reserved)",
  },
  {
    ms: 800,
    kind: "decision",
    summary_ar: "سلّم نتيجة أولى فيها خطأ مقصود، ليظهر مسار إعادة المحاولة",
    summary_en: "Returning a deliberately invalid output to show the retry path",
  },
];

const retrySteps = (feedback: string[]): ScriptStep[] => [
  {
    ms: 1200,
    kind: "decision",
    summary_ar: "قرأ ملاحظات التحقق: يجب أن يكون العدد رقمًا لا نصًا",
    summary_en: `Fixing the output from validator feedback: ${feedback.join("; ")}`,
  },
  {
    ms: 1600,
    kind: "tool_call",
    summary_ar: "أعاد عدّ المصادر: فحص ٣، وقبل منها ٢",
    summary_en: "count_sources: 3 checked, 2 accepted",
  },
  {
    ms: 1400,
    kind: "decision",
    summary_ar: "سلّم النتيجة المصححة",
    summary_en: "Returning the corrected output",
  },
];

const RESULT: DummyOutput = {
  checked: 3,
  accepted: 2,
  note_ar: "تشغيل تجريبي: فُحص ٣ مصادر، وقُبل منها ٢",
};

function createDummyAgent(sleep: Sleep): Agent<null, typeof DummyOutput> {
  const play = async (ctx: AgentContext, steps: ScriptStep[]) => {
    for (const { ms, ...event } of steps) {
      await sleep(ms);
      ctx.trace(event.kind === "tool_call" ? { ...event, latency_ms: ms } : event);
    }
  };
  return {
    name: "dummy",
    output: DummyOutput,
    async run(ctx) {
      if (ctx.feedback === null) {
        await play(ctx, FIRST_ATTEMPT);
        return { ...RESULT, checked: "ثلاثة" }; // a count as text breaks the contract on purpose
      }
      await play(ctx, retrySteps(ctx.feedback));
      return RESULT;
    },
  };
}

// The dummy makes no model calls; a call would fail its attempt loudly.
const noModelCalls = (): never => {
  throw new Error("The dummy run makes no model calls");
};
const NO_MODELS: Provider = {
  chat: noModelCalls,
  structured: noModelCalls,
  webSearch: noModelCalls,
  transcribe: noModelCalls,
  imageEdit: noModelCalls,
  segment: noModelCalls,
  totalCostUsd: () => 0,
};

export type DummyRunOutcome =
  | { status: "done"; key: string; output: DummyOutput }
  | { status: "failed"; key: string; error: string };

export type DummyRunnerOptions = { store?: Store; sleep?: Sleep; clock?: TraceClock };

// Counts a session's dummy runs, so each run gets its own step key and runs again.
const RUNS_DOC = "dummy_runs";

export function createDummyRunner({
  store = createFileStore(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock,
}: DummyRunnerOptions = {}) {
  const agent = createDummyAgent(sleep);
  const running = new Set<string>();

  return {
    // Starts a run and returns its outcome, which never rejects, or null while the session
    // already has a run. Throws when the store rejects the session id.
    start(sessionId: string): Promise<DummyRunOutcome> | null {
      const runs = store.readDoc<{ count: number }>(sessionId, RUNS_DOC)?.count ?? 0;
      if (running.has(sessionId)) return null;
      store.writeDoc(sessionId, RUNS_DOC, { count: runs + 1 });
      running.add(sessionId);
      const key = `${agent.name}:${runs + 1}`;

      // A fresh orchestrator per run: its tracer continues ids from the stored trace.
      const orchestrator = createOrchestrator({ store, makeProvider: () => NO_MODELS, clock });
      return orchestrator
        .runStep(sessionId, agent, null, { key })
        .then(
          (output): DummyRunOutcome => ({ status: "done", key, output }),
          (e: unknown): DummyRunOutcome => ({
            status: "failed",
            key,
            error: e instanceof Error ? e.message : String(e),
          }),
        )
        .finally(() => running.delete(sessionId));
    },
  };
}
