// The coach scheduler (#23): a table of rules, each due at a simulated time. A tick fires every due
// rule that has not fired, in time order, and records it in a fired-key ledger in the session
// store, so moving the clock over the same window again fires nothing new.
// The table is a placeholder: #25 replaces it with the real escalation ladder.

import type { CoachEvent } from "../../../contracts/index.ts";
import type { Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import { compareSimTime, type SimTime, startOfDay } from "./time.ts";

export type RuleContext = { learner: { id: string; name: string } };

export type CoachRule = {
  // The ledger key; also the message's template name.
  key: string;
  at: SimTime;
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
): CoachRule => ({
  key,
  at: startOfDay(day),
  fire: ({ learner }) => ({
    id,
    sim_day: day,
    type,
    channel: "simulated",
    message_ar: fillTemplate(text, { name: learner.name }),
    status: "queued",
  }),
});

// Each fires at the start of its day. Day 2 is the nudge the seed already holds as queued (c1 in
// demo/fixtures/omar.json), so firing it updates that event.
export const PLACEHOLDER_RULES: readonly CoachRule[] = [
  placeholder(
    "nudge_day2",
    2,
    "c1",
    "nudge",
    "مرحبًا {name}، عشر دقائق اليوم تكفي لتتقدم في درسك. ابدأ بمهمة قصيرة.",
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

export type SchedulerOptions = {
  store: Store;
  sessionId: string;
  tracer: Tracer;
  context: RuleContext;
  // The session's coach events before any rule fired: the seed's.
  initialEvents: CoachEvent[];
  rules?: readonly CoachRule[];
};

export function createScheduler({
  store,
  sessionId,
  tracer,
  context,
  initialEvents,
  rules = PLACEHOLDER_RULES,
}: SchedulerOptions) {
  const fired = () =>
    new Set(store.readDoc<{ fired: string[] }>(sessionId, LEDGER_DOC)?.fired ?? []);
  const events = () => store.readDoc<CoachEvent[]>(sessionId, EVENTS_DOC) ?? initialEvents;
  const save = (event: CoachEvent) => {
    const others = events().filter((e) => e.id !== event.id);
    store.writeDoc(sessionId, EVENTS_DOC, [...others, event]);
  };

  return {
    events,
    // Fires every rule due at or before `upTo` that is not in the ledger, oldest first, and returns
    // the coach events they fired.
    tick(upTo: SimTime): CoachEvent[] {
      const done = fired();
      const due = rules
        .filter((rule) => !done.has(rule.key) && compareSimTime(rule.at, upTo) <= 0)
        .sort((a, b) => compareSimTime(a.at, b.at) || a.key.localeCompare(b.key));

      return due.map((rule) => {
        const event = rule.fire(context);
        save(event);
        done.add(rule.key);
        store.writeDoc(sessionId, LEDGER_DOC, { fired: [...done] });
        tracer.emit({
          agent: "scheduler",
          kind: "decision",
          at: rule.at,
          summary_ar: `حلّ موعد رسالة المدرب لليوم ${rule.at.day}`,
          summary_en: `Coach rule ${rule.key} fired: ${event.type} ${event.id} for ${context.learner.id}`,
        });
        return event;
      });
    },
  };
}
