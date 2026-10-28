// Learner-facing activity (#15): one trace event becomes one plain-Arabic line for «ما يحدث الآن».
// No model ids, costs or step keys reach the learner; retries and failures are told calmly.

import type { TraceEvent } from "../../server/trace/trace.ts";
import { agentJob, agentName } from "./agents.ts";
import { arabicDigits } from "./format.ts";

export type ActivityTone = "working" | "retrying" | "warning" | "done" | "failed";

export type ActivityItem = {
  id: string;
  agent: string;
  agentName: string;
  tone: ActivityTone;
  text: string;
  // Wall time of the event (ISO), for display.
  at: string;
};

// The English summaries the orchestrator and the tracer write for their own events
// (src/server/orchestrator/orchestrator.ts, src/server/trace/trace.ts). activity.test.ts drives the
// real orchestrator, so a change of wording there fails that test.
const STEP_START = /^Starting step /;
const STEP_RESUMED = /^Step .+ already done; resuming/;
const STEP_RETRY = / attempt 1 failed; retrying once/;
const STEP_FAILED = / attempt 2 failed; giving up/;
const STEP_OUTPUT = / output matches its contract$/;
const MODEL_CALL_FAILED = /^Model call failed \(attempt \d+\)/;

const TEXT = {
  retry: "لم تكتمل محاولته الأولى كما يجب، فيعيد المحاولة مرة واحدة.",
  failed: "تعذّر إكمال هذه الخطوة بعد محاولتين. ما اكتمل قبلها محفوظ.",
  // The provider may retry or give up; its next event, or the orchestrator's, says which.
  modelFailed: "لم يصل ردّ مناسب من النموذج.",
  done: "أنهى عمله، وتحقّق النظام من نتيجته.",
};

function startText(agent: string): string {
  const job = agentJob(agent);
  return job ? `بدأ العمل: ${job}.` : "بدأ العمل.";
}

// Returns null for events that change nothing for the learner (a step resumed from its saved output).
export function toActivityItem(event: TraceEvent): ActivityItem | null {
  const item = (tone: ActivityTone, text: string): ActivityItem => ({
    id: event.id,
    agent: event.agent,
    agentName: agentName(event.agent),
    tone,
    text: arabicDigits(text),
    at: event.ts,
  });
  const en = event.summary_en;

  switch (event.kind) {
    case "decision":
      if (STEP_RESUMED.test(en)) return null;
      if (STEP_START.test(en)) return item("working", startText(event.agent));
      return item("working", event.summary_ar);
    case "error":
      if (STEP_RETRY.test(en)) return item("retrying", TEXT.retry);
      if (STEP_FAILED.test(en)) return item("failed", TEXT.failed);
      if (MODEL_CALL_FAILED.test(en)) return item("warning", TEXT.modelFailed);
      return item("warning", event.summary_ar);
    case "output":
      return item("done", STEP_OUTPUT.test(en) ? TEXT.done : event.summary_ar);
    case "tool_call":
    case "model_call":
      return item("working", event.summary_ar);
  }
}
