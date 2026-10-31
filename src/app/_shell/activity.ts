// Learner-facing activity (#15): one trace event becomes one plain-Arabic line for «ما يحدث الآن».
// No model ids, costs or step keys reach the learner; retries and failures are told calmly.

import { DAY_ZERO, parseSimTime, type SimTime } from "../../server/clock/time.ts";
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
  // Wall time of the event (ISO), and its simulated time when it has one; the feed shows the latter.
  at: string;
  simAt: SimTime | null;
};

// Instant bookkeeping of the clock, the coach scheduler, the notifier and the demo reset, not agent
// work: the clock pill and the coach page show it, and the drawer lists it.
const SYSTEM_ACTORS = new Set(["clock", "scheduler", "notifier", "sim"]);

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

// Returns null for events that are not agent work, and for those that change nothing for the
// learner (a step resumed from its saved output).
export function toActivityItem(event: TraceEvent): ActivityItem | null {
  if (SYSTEM_ACTORS.has(event.agent)) return null;
  const item = (tone: ActivityTone, text: string): ActivityItem => ({
    id: event.id,
    agent: event.agent,
    agentName: agentName(event.agent),
    tone,
    text: arabicDigits(text),
    at: event.ts,
    simAt: event.sim_ts ? parseSimTime(event.sim_ts) : null,
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

// Whether an agent is at work: a step that started and has neither its output nor its final
// failure yet. A decision outside any step, such as the coach resetting its ladder, is done when
// it is traced.
export function stepsRunning(events: readonly TraceEvent[]): boolean {
  const open = new Set<string>();
  for (const { summary_en: en } of events) {
    const started = /^Starting step (.+)$/.exec(en)?.[1];
    if (started) open.add(started);
    const ended = /^(.+) (?:output matches its contract$|attempt 2 failed; giving up)/.exec(
      en,
    )?.[1];
    if (ended) open.delete(ended);
  }
  return open.size > 0;
}

// Where the simulated clock is: every move of the clock emits one event under the agent "clock",
// stamped with the new time (src/server/clock/clock.ts). A session whose clock never moved is at
// day 0.
export function clockNow(events: readonly TraceEvent[]): SimTime {
  const last = events.findLast((e) => e.agent === "clock" && e.sim_ts !== null);
  return last?.sim_ts ? parseSimTime(last.sim_ts) : DAY_ZERO;
}
