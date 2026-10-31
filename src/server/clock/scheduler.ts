// The coach scheduler (#23): the rules a source lists, each due at a simulated time. A tick fires
// every due rule that has not fired, in time order and one at a time, sends its message through the
// notifier, and records it in a fired-key ledger in the session store, so moving the clock over the
// same window again fires nothing new. Deferred messages are delivered as the tick passes their time.
// The coach's ladder (#25) is the source.

import type { CoachEvent } from "../../../contracts/index.ts";
import type { Cta, Notifier, SendStatus } from "../notifier/notifier.ts";
import type { Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import { compareSimTime, formatSimTime, type SimTime } from "./time.ts";

export type CoachRule = {
  // The ledger key; also the fired event's id.
  key: string;
  at: SimTime;
  type: CoachEvent["type"];
  template: string;
  cta: Cta | null;
  // For the fire trace. It names the learner by id at most, and holds no message text.
  why: { ar: string; en: string };
  write(): Promise<string>;
};

// The rules due by `upTo`. It may list rules that fired before; the ledger skips them.
export type RuleSource = (upTo: SimTime) => readonly CoachRule[];

export const LEDGER_DOC = "scheduler";
export const EVENTS_DOC = "coach_events";

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
  learnerId: string;
  // The session's coach events before any rule fired: the seed's.
  initialEvents: CoachEvent[];
  rules: RuleSource;
};

export function createScheduler({
  store,
  sessionId,
  tracer,
  notifier,
  learnerId,
  initialEvents,
  rules,
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

  const fire = (rule: CoachRule, text: string) => {
    const event: CoachEvent = {
      id: rule.key,
      sim_day: rule.at.day,
      type: rule.type,
      channel: "simulated",
      message_ar: text,
      status: "queued",
    };
    tracer.emit({
      agent: "scheduler",
      kind: "decision",
      at: rule.at,
      summary_ar: rule.why.ar,
      summary_en: rule.why.en,
    });
    save([...events().filter((e) => e.id !== event.id), event]);
    notifier.send({
      id: event.id,
      to: learnerId,
      channel: notifier.capabilities().channel,
      template: rule.template,
      text_ar: text,
      cta: rule.cta,
      sim_ts: formatSimTime(rule.at),
    });
  };

  return {
    events,
    syncStatuses,
    // Fires every rule due at or before `upTo` that is not in the ledger, oldest first and one at a
    // time, delivering deferred messages as their time comes, and returns the coach events it fired.
    async tick(upTo: SimTime): Promise<CoachEvent[]> {
      const done = fired();
      const due = rules(upTo)
        .filter((rule) => !done.has(rule.key) && compareSimTime(rule.at, upTo) <= 0)
        .toSorted((a, b) => compareSimTime(a.at, b.at) || a.key.localeCompare(b.key));

      for (const rule of due) {
        notifier.deliverDue(rule.at);
        // The outbox ignores a message id it already holds, so a crash before the ledger write
        // cannot send twice.
        fire(rule, await rule.write());
        done.add(rule.key);
        store.writeDoc(sessionId, LEDGER_DOC, { fired: [...done] });
      }
      notifier.deliverDue(upTo);
      syncStatuses();
      const all = events();
      return due.flatMap((rule) => all.filter((e) => e.id === rule.key));
    },
  };
}
