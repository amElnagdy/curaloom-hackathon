// The coach (#25): the ladder's rungs as the scheduler's rules, each with its Arabic template, its
// button and the reason the trace gives, and the learner's answers to its check-in. Spark words each
// message from a brief that names no one; code puts the learner's name in, and sends the template
// when the wording fails or the learner has the messages off. The rungs come from the learner's
// study facts and their answers on every call, so the coach stores only those answers and the anchor
// it last saw, which lets it trace a reset once.

import {
  CHECKIN_CHOICES,
  type CheckinChoice,
  type CheckinReply,
  CoachDraft,
  type Consent,
  validate,
} from "../../../contracts/index.ts";
import { PASS_THRESHOLD } from "../agents/examiner/examiner.ts";
import { addressIn } from "../agents/lesson/rules.ts";
import { arabicSimTime } from "../clock/clock.ts";
import type { CoachRule, RuleSource } from "../clock/scheduler.ts";
import { formatSimTime, parseSimTime, type SimTime } from "../clock/time.ts";
import { type GateDecision, gate } from "../notifier/gate.ts";
import type { Cta, Notifier } from "../notifier/notifier.ts";
import {
  type Agent,
  type createOrchestrator,
  StepFailed,
  withFeedback,
} from "../orchestrator/orchestrator.ts";
import { contentHash, type Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import {
  anchorOf,
  type Ladder,
  ladderAt,
  type Pause,
  pauseFor,
  type Rung,
  type RungKind,
  rungsThrough,
} from "./ladder.ts";

export const COACH_DOC = "coach";
// An answer as the coach keeps it: when it came, the anchor it belongs to, and the plan version a
// shrink saved.
export type CheckinAnswer = CheckinReply & {
  sim_ts: string;
  anchor: number;
  plan_version: number | null;
};
type CoachDoc = { anchor: number | null; replies: CheckinAnswer[] };

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
// What the re-planner did with the learner's request: the version it saved and the minutes of the
// committed weeks before and after, or why it changed nothing, with the sentence the coach sends
// back in Arabic.
export type Replanned =
  | { ok: true; version: number; minutes: { before: number; after: number } }
  | { ok: false; why: { en: string; ar: string } };
export const NO_PLAN: Replanned = {
  ok: false,
  why: { en: "the learner has no plan of their own yet", ar: "سنجعل جلساتك أقصر حين تجهز خطتك." },
};
export type CoachDeps = {
  // Runs the coach writer; null sends every message as its template.
  steps: Pick<ReturnType<typeof createOrchestrator>, "runStep"> | null;
  study(): Study;
  // #26's re-planner widens the reasons.
  replan(reason: "shrink"): Promise<Replanned>;
};

// An answer to a message that is not a check-in the learner has and can still answer.
export class CheckinConflict extends Error {}
// `paused_until` as "day 17 09:00".
export type AnswerResult = {
  choice: CheckinChoice;
  paused_until: string | null;
  plan_version: number | null;
};

type Lesson = Study["lesson"];
// `purpose` tells the coach writer what the message is for, and `score` whether it hears the best
// quiz score: only the nudge, whose short task could take them through the gate. `name_ar` names
// the message in the trace.
type RungMessage = {
  template: string;
  cta(lesson: Lesson): Cta | null;
  why_ar: string;
  purpose: string;
  score: boolean;
  name_ar: string;
};

const OPEN_PLAN: Cta = { label_ar: "افتح خطتي", action: "open_plan" };

const RUNG_MESSAGES: Record<RungKind, RungMessage> = {
  d2: {
    template: "مرحبًا {name}، عشر دقائق اليوم تكفي لتتقدم في درسك. ابدأ بمهمة قصيرة.",
    cta: (lesson) =>
      lesson && { label_ar: "ابدأ مهمة ١٠ دقائق", action: "open_lesson", lesson_id: lesson.id },
    why_ar: "مرّ يومان دون دراسة، فاقترح المدرب مهمة من عشر دقائق",
    purpose: "a nudge after two days without study: suggest one 10-minute task on their lesson",
    score: true,
    name_ar: "تذكير اليوم الثاني",
  },
  d5: {
    template:
      "{name}، يبدو أن أسبوعك مزدحم. يمكن أن نجعله أخف: جلسات أقصر والهدف نفسه. افتح خطتك واختر ما يناسبك.",
    cta: () => OPEN_PLAN,
    why_ar: "مرّت خمسة أيام دون دراسة، فعرض المدرب أسبوعًا أخف",
    purpose:
      "an offer after five days without study: they can make this week lighter, with shorter sessions and the same goal; the button under the message opens their plan",
    score: false,
    name_ar: "عرض الأسبوع الأخف",
  },
  d10: {
    template:
      "{name}، مرّت عشرة أيام منذ آخر اختبار، ولا بأس في ذلك. ما الذي يناسبك الآن: استراحة أسبوع، أم جلسات أقصر، أم مصدر آخر؟",
    cta: () => ({
      action: "choose",
      options: CHECKIN_CHOICES.map((choice) => ({ choice, label_ar: CHOICE_LABEL[choice] })),
    }),
    why_ar: "مرّت عشرة أيام دون دراسة، فسأل المدرب عمّا يناسبه",
    purpose:
      "a check-in ten days after their last quiz: say a break is fine, and ask what suits them now",
    score: false,
    name_ar: "سؤال اليوم العاشر",
  },
  weekly: {
    template: "{name}، مكانك في الدورة محفوظ. عُد متى شئت، وابدأ بمراجعة قصيرة.",
    cta: (lesson) =>
      lesson && { label_ar: "مراجعة قصيرة", action: "open_lesson", lesson_id: lesson.id },
    why_ar: "مرّ أسبوع آخر دون دراسة، فأرسل المدرب رسالته الأسبوعية",
    purpose:
      "the weekly message while they are away: their place in the course is kept, and they can come back any time, starting with a short review",
    score: false,
    name_ar: "الرسالة الأسبوعية",
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

// Why the gate holds every message back, for the trace of a message written with no model call.
type OffRule = Extract<GateDecision, { status: "suppressed_opt_out" }>["rule"];
const MESSAGES_OFF: Record<OffRule, { ar: string; en: string }> = {
  opted_out: { ar: "أوقف المتعلم رسائل المدرب", en: "opted out" },
  not_granted: { ar: "لم يوافق المتعلم على رسائل المدرب بعد", en: "no consent" },
};

// The longest draft for each tone, counting {name} as written.
export const MAX_DRAFT = { gentle: 160, normal: 260 } as const satisfies Record<
  Consent["intensity"],
  number
>;
const TONE: Record<Consent["intensity"], string> = {
  gentle: "gentle: one or two short, soft sentences",
  normal: "plain and direct",
};

// What the coach writer knows: the rung, the days since the last quiz, the tone the learner chose
// and the lesson they are on. No name, id, topic or time, so a recording fits any learner at the
// same place on the ladder.
export type CoachBrief = {
  rung: RungKind;
  inactive_days: number;
  intensity: Consent["intensity"];
  lesson_title_ar: string | null;
  best_percent: number | null;
  gate_percent: number;
  template_ar: string;
  choices_ar: string[];
};

const WRITE = [
  "You write one short message from a learning coach to an Arabic-speaking adult who has not studied for some days. It goes to their phone.",
  "Write in Modern Standard Arabic: warm and respectful, with no guilt, blame or pressure. Never reproach them for the days away.",
  "Write it in your own words for this learner; do not copy the template. The template shows the message's purpose and the facts to keep. Make no offer, promise or number that the template and the brief do not give.",
  "You may name the current lesson in a few words. When the brief gives the best score, you may say how close it is to the gate, as encouragement. Write numbers in Arabic-Indic digits.",
  "Write {name} exactly once, where the learner's first name goes; code puts the name in. Write no other braces.",
  "Write no links, no web or email addresses and no emoji.",
  "Keep to the tone and the length the brief gives.",
  "When the brief lists choices, invite them in that order and in those words; buttons under the message repeat them.",
].join("\n");

const briefLines = (brief: CoachBrief) =>
  [
    `Message: ${RUNG_MESSAGES[brief.rung].purpose}`,
    `Days since their last quiz: ${brief.inactive_days}`,
    `Tone: ${TONE[brief.intensity]}, at most ${MAX_DRAFT[brief.intensity]} characters`,
    `Current lesson: ${brief.lesson_title_ar ?? "none yet"}`,
    ...(brief.best_percent === null
      ? []
      : [`Best quiz score on it: ${brief.best_percent}% (the gate is ${brief.gate_percent}%)`]),
    ...(brief.choices_ar.length
      ? [`Choices to invite, in this order: ${brief.choices_ar.join("، ")}`]
      : []),
    `Template: ${brief.template_ar}`,
  ].join("\n");

// Why a draft cannot go to the learner. No reason quotes the draft, so the reasons can go into the
// trace and back to the model.
export function draftViolations(text: string, intensity: Consent["intensity"]): string[] {
  const problems: string[] = [];
  if (!/\p{Script=Arabic}/u.test(text)) problems.push("the message has no Arabic text");
  const names = text.split("{name}").length - 1;
  if (names !== 1) problems.push(`the message has {name} ${names} times; write it exactly once`);
  if (/[{}]/.test(text.replaceAll("{name}", ""))) {
    problems.push("the message has braces other than {name}");
  }
  if (addressIn(text)) problems.push("the message has a web address or email");
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push("the message has an emoji");
  const max = MAX_DRAFT[intensity];
  if (text.length > max) problems.push(`the message has ${text.length} characters; at most ${max}`);
  return problems;
}

export const coachWriter: Agent<CoachBrief, typeof CoachDraft> = {
  name: "coach",
  output: CoachDraft,
  async run(ctx, brief) {
    const { json } = await ctx.provider.structured({
      role: "coach",
      trace: {
        agent: "coach",
        summary_ar: `يصوغ المدرب ${RUNG_MESSAGES[brief.rung].name_ar}`,
        summary_en: `Wording the coach's ${brief.rung} message`,
      },
      instructions: WRITE,
      input: withFeedback(ctx, briefLines(brief)),
      schema: { name: "CoachDraft", schema: CoachDraft },
    });
    const message_ar = validate(CoachDraft, json).message_ar.trim();
    const broken = draftViolations(message_ar, brief.intensity);
    if (broken.length) throw new Error(`The message breaks its rules: ${broken.join("; ")}`);
    return { message_ar };
  },
};

// Two days away or more is a comeback, which #27 answers with a recap.
const COMEBACK_DAYS = 2;

export type CoachOptions = CoachDeps & {
  store: Store;
  sessionId: string;
  tracer: Tracer;
  notifier: Notifier;
  learner: { id: string; name: string };
};

// What an answer does: the pause or plan version it made, the acknowledgement and the trace's reason.
type Outcome = {
  paused_until: SimTime | null;
  plan_version: number | null;
  ack: { text_ar: string; cta: Cta | null };
  why: { ar: string; en: string };
};

export function createCoach({
  store,
  sessionId,
  tracer,
  notifier,
  learner,
  steps,
  study,
  replan,
}: CoachOptions) {
  const doc = (): CoachDoc => ({
    anchor: null,
    replies: [],
    ...store.readDoc<CoachDoc>(sessionId, COACH_DOC),
  });
  const replies = () => doc().replies;
  // The pause the learner chose since their last quiz: a quiz ends it.
  const pauseAt = (anchor: number): Pause | null => {
    const chosen = replies().findLast((r) => r.choice === "pause" && r.anchor === anchor);
    return chosen ? pauseFor(anchor, parseSimTime(chosen.sim_ts), chosen.pause_days) : null;
  };
  const messagesOn = () => {
    const consent = notifier.consent();
    return consent.granted && !consent.opted_out;
  };

  // The rung's message in Spark's words, or its template when there is no writer, the learner has
  // the messages off, or the wording fails.
  const write = async (rung: Rung, lesson: Lesson, cta: Cta | null): Promise<string> => {
    const message = RUNG_MESSAGES[rung.kind];
    const template = fillTemplate(message.template, { name: learner.name });
    if (!steps) return template;
    const consent = notifier.consent();
    const decision = gate(consent, rung.at);
    if (decision.status === "suppressed_opt_out") {
      const off = MESSAGES_OFF[decision.rule];
      tracer.emit({
        agent: "coach",
        kind: "decision",
        at: rung.at,
        summary_ar: `${off.ar}، فسُجّلت الرسالة بنصها الجاهز دون استدعاء النموذج`,
        summary_en: `${rung.id}: template, no model call: ${off.en}`,
      });
      return template;
    }
    const brief: CoachBrief = {
      rung: rung.kind,
      inactive_days: rung.inactive_days,
      intensity: consent.intensity,
      lesson_title_ar: lesson?.title_ar ?? null,
      best_percent: message.score ? (lesson?.best_percent ?? null) : null,
      gate_percent: Math.round(PASS_THRESHOLD * 100),
      template_ar: message.template,
      choices_ar: cta?.action === "choose" ? cta.options.map((o) => o.label_ar) : [],
    };
    try {
      const { message_ar } = await steps.runStep(sessionId, coachWriter, brief, {
        key: `coach:${rung.id}:${contentHash(brief)}`,
      });
      return fillTemplate(message_ar, { name: learner.name });
    } catch (e) {
      if (!(e instanceof StepFailed)) throw e;
      tracer.emit({
        agent: "coach",
        kind: "decision",
        at: rung.at,
        summary_ar: "تعذّرت صياغة الرسالة بالنموذج، فأُرسل نصها الجاهز",
        summary_en: `${rung.id}: the model's wording failed (${e.message}); sent the template`,
      });
      return template;
    }
  };

  const ruleOf = (rung: Rung, anchor: number, lesson: Lesson): CoachRule => {
    const message = RUNG_MESSAGES[rung.kind];
    const cta = message.cta(lesson);
    return {
      key: rung.id,
      at: rung.at,
      type: rung.type,
      template: `coach_${rung.kind}`,
      cta,
      why: {
        ar: message.why_ar,
        en: `${rung.id}: ${rung.inactive_days} days without a quiz since day ${anchor} -> ${rung.state}`,
      },
      write: () => write(rung, lesson, cta),
    };
  };

  const rules: RuleSource = (upTo) => {
    const { attempt_days, lesson } = study();
    const anchor = anchorOf(attempt_days);
    return rungsThrough({ anchor, pause: pauseAt(anchor) }, upTo).map((rung) =>
      ruleOf(rung, anchor, lesson),
    );
  };

  const outcomeOf = async (
    { choice, pause_days }: CheckinReply,
    anchor: number,
    at: SimTime,
  ): Promise<Outcome> => {
    switch (choice) {
      case "pause": {
        const { until } = pauseFor(anchor, at, pause_days);
        return {
          paused_until: until,
          plan_version: null,
          ack: {
            text_ar: `حسنًا، لا رسائل مني حتى اليوم ${until.day.toLocaleString("ar-EG")}. خطتك ومكانك محفوظان.`,
            cta: null,
          },
          why: {
            ar: `اختار ${learner.id} استراحة، فلا رسائل من المدرب حتى ${arabicSimTime(until)}`,
            en: `pause; no coach messages until ${formatSimTime(until)}`,
          },
        };
      }
      case "shrink": {
        const replanned = await replan("shrink");
        if (!replanned.ok) {
          return {
            paused_until: null,
            plan_version: null,
            ack: { text_ar: replanned.why.ar, cta: null },
            why: {
              ar: `اختار ${learner.id} جلسات أقصر، ولم تتغير خطته`,
              en: `shrink; plan unchanged: ${replanned.why.en}`,
            },
          };
        }
        const { version, minutes } = replanned;
        return {
          paused_until: null,
          plan_version: version,
          ack: {
            text_ar: "خفّفنا خطتك: جلسات أقصر والهدف نفسه. تجد النسخة الجديدة في خطتك.",
            cta: OPEN_PLAN,
          },
          why: {
            ar: `اختار ${learner.id} جلسات أقصر، فصارت جلسات أسبوعيه الأولين ${minutes.after} دقيقة بدل ${minutes.before} في النسخة ${version} من خطته`,
            en: `shrink; plan version ${version}, ${minutes.before} -> ${minutes.after} minutes over the committed weeks`,
          },
        };
      }
      case "switch":
        return {
          paused_until: null,
          plan_version: null,
          ack: { text_ar: "سنقترح عليك مصدرًا آخر للدرس نفسه.", cta: OPEN_PLAN },
          why: {
            ar: `اختار ${learner.id} مصدرًا آخر، فسُجّل طلبه ليختار المخطط مصدرًا بديلًا`,
            en: "switch recorded; the re-planner (#26) picks another resource",
          },
        };
    }
  };

  return {
    rules,

    ladder(now: SimTime): Ladder {
      const anchor = anchorOf(study().attempt_days);
      return ladderAt({ anchor, pause: pauseAt(anchor), messages_on: messagesOn() }, now);
    },

    replies,

    // The learner's tap on a check-in's button, at `at`: it shows on the phone as their reply, does
    // what they chose, and is acknowledged through the notifier, so quiet hours hold the answer
    // back like any coach message. A reply is not activity, so the ladder goes on.
    async answer(reply: CheckinReply, at: SimTime): Promise<AnswerResult> {
      const { event_id, choice } = reply;
      const entry = notifier.outbox().find((e) => e.message.id === event_id);
      if (entry?.status !== "sent") {
        throw new CheckinConflict(`${event_id} has not reached ${learner.id}`);
      }
      const cta = entry.message.cta;
      if (cta?.action !== "choose" || !cta.options.some((o) => o.choice === choice)) {
        throw new CheckinConflict(`${event_id} does not offer ${choice}`);
      }
      if (replies().some((r) => r.event_id === event_id)) {
        throw new CheckinConflict(`${event_id} is answered already`);
      }
      if (!messagesOn()) throw new CheckinConflict(`${learner.id} has the coach's messages off`);

      notifier.receive(CHOICE_LABEL[choice], at);
      const anchor = anchorOf(study().attempt_days);
      const outcome = await outcomeOf(reply, anchor, at);
      const saved = doc();
      store.writeDoc(sessionId, COACH_DOC, {
        ...saved,
        replies: [
          ...saved.replies,
          { ...reply, sim_ts: formatSimTime(at), anchor, plan_version: outcome.plan_version },
        ],
      } satisfies CoachDoc);
      tracer.emit({
        agent: "coach",
        kind: "decision",
        at,
        summary_ar: outcome.why.ar,
        summary_en: `${event_id} answered by ${learner.id}: ${outcome.why.en}`,
      });
      notifier.send({
        id: `ack_${event_id}`,
        to: learner.id,
        channel: notifier.capabilities().channel,
        template: `checkin_ack_${choice}`,
        text_ar: outcome.ack.text_ar,
        cta: outcome.ack.cta,
        sim_ts: formatSimTime(at),
      });
      return {
        choice,
        paused_until: outcome.paused_until && formatSimTime(outcome.paused_until),
        plan_version: outcome.plan_version,
      };
    },

    // Called as the clock leaves `at`: a quiz since the last move started the ladder again.
    observe(at: SimTime) {
      const saved = doc();
      const seen = saved.anchor;
      const anchor = anchorOf(study().attempt_days);
      if (seen === anchor) return;
      store.writeDoc(sessionId, COACH_DOC, { ...saved, anchor } satisfies CoachDoc);
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
