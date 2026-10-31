// The coach (#25): the ladder's rungs as the scheduler's rules, each with its Arabic template, its
// button and the reason the trace gives. The rungs come from the learner's study facts on every
// call, so nothing about the ladder is stored but the anchor the coach last saw, which lets it
// trace a reset once.

import { CHECKIN_CHOICES, type CheckinChoice } from "../../../contracts/index.ts";
import type { CoachRule, RuleSource } from "../clock/scheduler.ts";
import type { SimTime } from "../clock/time.ts";
import type { Cta, Notifier } from "../notifier/notifier.ts";
import type { Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import {
  anchorOf,
  type Ladder,
  ladderAt,
  type Rung,
  type RungKind,
  rungsThrough,
} from "./ladder.ts";

export const COACH_DOC = "coach";
type CoachDoc = { anchor: number | null };

export const CHOICE_LABEL: Record<CheckinChoice, string> = {
  pause: "استراحة أسبوع",
  shrink: "جلسات أقصر",
  switch: "مصدر آخر",
};

// What the coach knows of the learner's study: the days of their quizzes, the only activity with a
// record yet, and the lesson they are on.
export type Study = {
  attempt_days: number[];
  lesson: { id: string; title_ar: string; best_percent: number | null } | null;
};
export type CoachDeps = { study(): Study };

type Lesson = Study["lesson"];
type RungMessage = { template: string; cta(lesson: Lesson): Cta | null; why_ar: string };

const RUNG_MESSAGES: Record<RungKind, RungMessage> = {
  d2: {
    template: "مرحبًا {name}، عشر دقائق اليوم تكفي لتتقدم في درسك. ابدأ بمهمة قصيرة.",
    cta: (lesson) =>
      lesson && { label_ar: "ابدأ مهمة ١٠ دقائق", action: "open_lesson", lesson_id: lesson.id },
    why_ar: "مرّ يومان دون دراسة، فاقترح المدرب مهمة من عشر دقائق",
  },
  d5: {
    template:
      "{name}، يبدو أن أسبوعك مزدحم. يمكن أن نجعله أخف: جلسات أقصر والهدف نفسه. افتح خطتك واختر ما يناسبك.",
    cta: () => ({ label_ar: "افتح خطتي", action: "open_plan" }),
    why_ar: "مرّت خمسة أيام دون دراسة، فعرض المدرب أسبوعًا أخف",
  },
  d10: {
    template:
      "{name}، مرّت عشرة أيام منذ آخر اختبار، ولا بأس في ذلك. ما الذي يناسبك الآن: استراحة أسبوع، أم جلسات أقصر، أم مصدر آخر؟",
    cta: () => ({
      action: "choose",
      options: CHECKIN_CHOICES.map((choice) => ({ choice, label_ar: CHOICE_LABEL[choice] })),
    }),
    why_ar: "مرّت عشرة أيام دون دراسة، فسأل المدرب عمّا يناسبه",
  },
  weekly: {
    template: "{name}، مكانك في الدورة محفوظ. عُد متى شئت، وابدأ بمراجعة قصيرة.",
    cta: (lesson) =>
      lesson && { label_ar: "مراجعة قصيرة", action: "open_lesson", lesson_id: lesson.id },
    why_ar: "مرّ أسبوع آخر دون دراسة، فأرسل المدرب رسالته الأسبوعية",
  },
};

// Arabic text with {name}-style variables.
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template variable {${name}} has no value`);
    return value;
  });
}

// Two days away or more is a comeback, which #27 answers with a recap.
const COMEBACK_DAYS = 2;

export type CoachOptions = CoachDeps & {
  store: Store;
  sessionId: string;
  tracer: Tracer;
  notifier: Notifier;
  learner: { id: string; name: string };
};

export function createCoach({ store, sessionId, tracer, notifier, learner, study }: CoachOptions) {
  const ruleOf = (rung: Rung, anchor: number, lesson: Lesson): CoachRule => {
    const message = RUNG_MESSAGES[rung.kind];
    return {
      key: rung.id,
      at: rung.at,
      type: rung.type,
      template: `coach_${rung.kind}`,
      cta: message.cta(lesson),
      why: {
        ar: message.why_ar,
        en: `${rung.id}: ${rung.inactive_days} days without a quiz since day ${anchor} -> ${rung.state}`,
      },
      write: async () => fillTemplate(message.template, { name: learner.name }),
    };
  };

  const rules: RuleSource = (upTo) => {
    const { attempt_days, lesson } = study();
    const anchor = anchorOf(attempt_days);
    return rungsThrough({ anchor, pause: null }, upTo).map((rung) => ruleOf(rung, anchor, lesson));
  };

  return {
    rules,

    ladder(now: SimTime): Ladder {
      const consent = notifier.consent();
      return ladderAt(
        {
          anchor: anchorOf(study().attempt_days),
          pause: null,
          messages_on: consent.granted && !consent.opted_out,
        },
        now,
      );
    },

    // Called as the clock leaves `at`: a quiz since the last move started the ladder again.
    observe(at: SimTime) {
      const doc = store.readDoc<CoachDoc>(sessionId, COACH_DOC);
      const seen = doc?.anchor ?? null;
      const anchor = anchorOf(study().attempt_days);
      if (seen === anchor) return;
      store.writeDoc(sessionId, COACH_DOC, { ...doc, anchor } satisfies CoachDoc);
      if (seen === null) return;
      const away = anchor - seen;
      const comeback = away >= COMEBACK_DAYS;
      tracer.emit({
        agent: "coach",
        kind: "decision",
        at,
        summary_ar: `أجبت عن اختبار في اليوم ${anchor}${comeback ? " بعد غياب" : ""}، فبدأ المدرب العدّ من جديد`,
        summary_en: `Ladder reset for ${learner.id}: a quiz on day ${anchor}, ${away} days after day ${seen}${comeback ? `; comeback after ${away} days (#27 runs the recap)` : ""}`,
      });
    },
  };
}
