// The coach scheduler (#23): a table of rules, each due at a simulated time. A tick fires every due
// rule that has not fired, in time order, sends its message through the notifier, and records it
// in a fired-key ledger in the session store, so moving the clock over the same window again fires
// nothing new. Deferred messages are delivered as the tick passes their time.
// The table is a placeholder: #25 replaces it with the real escalation ladder.

import type { CoachEvent } from "../../../contracts/index.ts";
import type { Cta, Notifier, SendStatus } from "../notifier/notifier.ts";
import type { Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import { compareSimTime, formatSimTime, type SimTime, startOfDay } from "./time.ts";

export type RuleContext = { learner: { id: string; name: string } };

export type CoachRule = {
  // The ledger key; also the message's template name.
  key: string;
  at: SimTime;
  cta?: Cta;
  fire(ctx: RuleContext): CoachEvent;
};

// Arabic text with {name}-style variables.
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template variable {${name}} has no value`);
    return value;
  });
}

const placeholder = (
  key: string,
  day: number,
  id: string,
  type: CoachEvent["type"],
  text: string,
  cta?: Cta,
): CoachRule => ({
  key,
  at: startOfDay(day),
  ...(cta && { cta }),
  fire: ({ learner }) => ({
    id,
    sim_day: day,
    type,
    channel: "simulated",
    message_ar: fillTemplate(text, { name: learner.name }),
    status: "queued",
  }),
});

// Each fires at the start of its day, inside the seed's quiet hours, so the notifier holds it until
// 12:00. Day 2 is the nudge the seed already holds as queued (c1 in demo/fixtures/omar.json), so
// firing it updates that event; its button opens the seed's lesson L1.
export const PLACEHOLDER_RULES: readonly CoachRule[] = [
  placeholder(
    "nudge_day2",
    2,
    "c1",
    "nudge",
    "مرحبًا {name}، عشر دقائق اليوم تكفي لتتقدم في درسك. ابدأ بمهمة قصيرة.",
    { label_ar: "ابدأ مهمة ١٠ دقائق", action: "open_lesson", lesson_id: "L1" },
  ),
  placeholder(
    "checkin_day5",
    5,
    "c2",
    "checkin",
    "{name}، مرّت أيام منذ جلستك الأخيرة. هل يناسبك وقت أقصر هذا الأسبوع؟",
  ),
  placeholder(
    "replan_day10",
    10,
    "c3",
    "replan",
    "{name}، عدّلنا خطتك لتناسب أسبوعك: جلسات أقصر والهدف نفسه. نكمل من حيث توقفت.",
  ),
  placeholder(
    "comeback_day17",
    17,
    "c4",
    "comeback",
    "{name}، مكانك في الدورة محفوظ. عُد متى شئت، وابدأ بمراجعة قصيرة.",
  ),
];

const LEDGER_DOC = "scheduler";
const EVENTS_DOC = "coach_events";

// A coach event's status follows its message's: a deferred message is still queued.
const EVENT_STATUS: Record<SendStatus, CoachEvent["status"]> = {
  sent: "sent",
  deferred: "queued",
  suppressed_opt_out: "suppressed_opt_out",
  suppressed_quiet_hours: "suppressed_quiet_hours",
};

export type SchedulerOptions = {
  store: Store;
  sessionId: string;
  tracer: Tracer;
  notifier: Notifier;
  context: RuleContext;
  // The session's coach events before any rule fired: the seed's.
  initialEvents: CoachEvent[];
  rules?: readonly CoachRule[];
};

export function createScheduler({
  store,
  sessionId,
  tracer,
  notifier,
  context,
  initialEvents,
  rules = PLACEHOLDER_RULES,
}: SchedulerOptions) {
  const fired = () =>
    new Set(store.readDoc<{ fired: string[] }>(sessionId, LEDGER_DOC)?.fired ?? []);
  const events = () => store.readDoc<CoachEvent[]>(sessionId, EVENTS_DOC) ?? initialEvents;
  const save = (next: CoachEvent[]) => store.writeDoc(sessionId, EVENTS_DOC, next);

  // Brings each coach event's status in line with its message in the notifier's outbox.
  const syncStatuses = () => {
    const sent = new Map(notifier.outbox().map((e) => [e.message.id, EVENT_STATUS[e.status]]));
    const current = events();
    const next = current.map((e) => ({ ...e, status: sent.get(e.id) ?? e.status }));
    if (next.some((e, i) => e.status !== current[i]?.status)) save(next);
  };

  const fire = (rule: CoachRule): string => {
    const event = rule.fire(context);
    tracer.emit({
      agent: "scheduler",
      kind: "decision",
      at: rule.at,
      summary_ar: `حلّ موعد رسالة المدرب لليوم ${rule.at.day}`,
      summary_en: `Coach rule ${rule.key} fired: ${event.type} ${event.id} for ${context.learner.id}`,
    });
    save([...events().filter((e) => e.id !== event.id), event]);
    notifier.send({
      id: event.id,
      to: context.learner.id,
      channel: notifier.capabilities().channel,
      template: rule.key,
      text_ar: event.message_ar,
      cta: rule.cta ?? null,
      sim_ts: formatSimTime(rule.at),
    });
    return event.id;
  };

  return {
    events,
    syncStatuses,
    // Fires every rule due at or before `upTo` that is not in the ledger, oldest first, delivering
    // deferred messages as their time comes, and returns the coach events it fired.
    tick(upTo: SimTime): CoachEvent[] {
      const done = fired();
      const due = rules
        .filter((rule) => !done.has(rule.key) && compareSimTime(rule.at, upTo) <= 0)
        .sort((a, b) => compareSimTime(a.at, b.at) || a.key.localeCompare(b.key));

      const ids = due.map((rule) => {
        notifier.deliverDue(rule.at);
        // The outbox ignores a message id it already holds, so a crash before the ledger write
        // cannot send twice.
        const id = fire(rule);
        done.add(rule.key);
        store.writeDoc(sessionId, LEDGER_DOC, { fired: [...done] });
        return id;
      });
      notifier.deliverDue(upTo);
      syncStatuses();
      const all = events();
      return ids.flatMap((id) => all.filter((e) => e.id === id));
    },
  };
}
