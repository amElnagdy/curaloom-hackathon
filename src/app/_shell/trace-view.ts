// What the trace drawer lists (#59, #60, #78): its Arabic names for event kinds and model roles, the
// session's events narrowed by agent and kind, with a run of repeats folded into one row, and the
// status line that counts what the list shows.

import type { TraceEvent, TraceKind } from "../../server/trace/trace.ts";
import { arabicNumber, type CountForms, countOf, EVENTS } from "./format.ts";

export const TRACE_KINDS: readonly TraceKind[] = [
  "model_call",
  "tool_call",
  "decision",
  "output",
  "error",
];

export const KIND_AR: Readonly<Record<TraceKind, string>> = {
  model_call: "طلب نموذج",
  tool_call: "استدعاء أداة",
  decision: "قرار",
  output: "مخرج",
  error: "خطأ",
};

// The model roles of config/models.yaml. A role missing here shows as written.
const ROLE_AR: Readonly<Record<string, string>> = {
  agent_default: "الدور الافتراضي",
  curriculum: "تصميم المنهج",
  judge: "المحكّم",
  coach: "المدرب",
  replan: "إعادة التخطيط",
  transcribe: "تفريغ الصوت",
  segment: "تجزئة الصورة",
  image_edit: "تحرير الصور",
  diagram_labels: "قراءة نصوص الرسوم",
  image_text: "نسخ نصوص الصور",
};

export function roleName(role: string): string {
  return ROLE_AR[role] ?? role;
}

// null is "all".
export type TraceFilter = { agent: string | null; kind: TraceKind | null; foldRepeats: boolean };

export const NO_FILTER: TraceFilter = { agent: null, kind: null, foldRepeats: false };

export type TraceRow = { event: TraceEvent; repeats: number };

// A repeat follows an event that says and costs exactly what it does, at the same simulated moment,
// such as a step a reload ran again (#58). The same words on another day, or after other events,
// are another piece of work (#78), and two model calls that wrote different replies differ in cost.
const repeatKey = (e: TraceEvent) =>
  JSON.stringify([e.agent, e.kind, e.summary_ar, e.summary_en, e.model, e.cost_usd, e.sim_ts]);

// The rows to show, oldest first. A run of repeats shows as its last event, with its count.
export function traceRows(events: readonly TraceEvent[], filter: TraceFilter): TraceRow[] {
  const matching = events.filter(
    (e) =>
      (filter.agent === null || e.agent === filter.agent) &&
      (filter.kind === null || e.kind === filter.kind),
  );
  if (!filter.foldRepeats) return matching.map((event) => ({ event, repeats: 1 }));
  const rows: TraceRow[] = [];
  for (const event of matching) {
    const last = rows.at(-1);
    if (last && repeatKey(last.event) === repeatKey(event)) {
      rows[rows.length - 1] = { event, repeats: last.repeats + 1 };
    } else rows.push({ event, repeats: 1 });
  }
  return rows;
}

const ROWS: CountForms = { one: "سطر واحد", two: "سطران", few: "أسطر", many: "سطرًا" };
const HOLD: Record<number, string> = { 1: "يضم", 2: "يضمّان" };
// The events as the object of «تضم».
const HELD: CountForms = { one: "حدثًا واحدًا", two: "حدثين", few: "أحداث", many: "حدثًا" };

// The status line under the filters: what the list shows of the session's `total` events. It is
// empty with no filter, and when nothing matches, where the empty state speaks instead.
export function shownText(rows: readonly TraceRow[], total: number, filter: TraceFilter): string {
  const narrowed = filter.agent !== null || filter.kind !== null;
  if (!rows.length || !(narrowed || filter.foldRepeats)) return "";
  if (!filter.foldRepeats) return `يعرض ${arabicNumber(rows.length)} من ${countOf(total, EVENTS)}`;
  const covered = rows.reduce((n, row) => n + row.repeats, 0);
  const events = `${countOf(covered, HELD)}${narrowed ? ` من ${arabicNumber(total)}` : ""}`;
  return `${countOf(rows.length, ROWS)} ${HOLD[rows.length] ?? "تضم"} ${events}`;
}

// The agents in the trace, in the order they first appear, for the agent filter.
export function traceAgents(events: readonly TraceEvent[]): string[] {
  return [...new Set(events.map((e) => e.agent))];
}
