// The notifier (#22, ADR-004): channel-agnostic sending with consent, quiet hours and opt-out
// enforced in one place. Every adapter delivery goes through `dispatch`, which asks the gate first.
// A deferred message waits in the session's outbox until a clock tick passes its time. An inbound
// stop word opts the learner out at once, in any state, with one confirmation.

import type { CheckinChoice, Consent } from "../../../contracts/index.ts";
import type { NotifierAdapterName } from "../../config.ts";
import { arabicSimTime } from "../clock/clock.ts";
import {
  compareSimTime,
  formatSimTime,
  parseSimTime,
  type SimTime,
  toMinutes,
} from "../clock/time.ts";
import type { Store } from "../store/store.ts";
import type { Tracer } from "../trace/trace.ts";
import { gate, type MessageKind, quietUntil } from "./gate.ts";

export type Cta =
  | { label_ar: string; action: "open_lesson"; lesson_id: string }
  | { label_ar: string; action: "open_plan" }
  | { action: "choose"; options: { choice: CheckinChoice; label_ar: string }[] };

export type NotifierMessage = {
  // One message per coach event: the event's id.
  id: string;
  // The learner id. Contact details stay with the adapter, never in messages or traces.
  to: string;
  channel: NotifierAdapterName;
  template: string;
  text_ar: string;
  cta: Cta | null;
  // When it is sent, e.g. "day 2 19:00".
  sim_ts: string;
};

// `deliver_at`: when it was or will be delivered; null when it never will be.
// `suppressed_quiet_hours` is for a message that cannot wait; none can yet, so quiet hours defer.
export type SendResult =
  | { status: "sent" | "deferred"; deliver_at: string }
  | { status: "suppressed_opt_out" | "suppressed_quiet_hours"; deliver_at: null };
export type SendStatus = SendResult["status"];

export type OutboxEntry = SendResult & { message: NotifierMessage };

export type Capabilities = {
  channel: NotifierAdapterName;
  cta: boolean;
  replies: boolean;
  max_text_length: number;
};

export type InboundReply = { from: string; text: string; sim_ts: string };

export type NotifierAdapter = {
  capabilities(): Capabilities;
  // Delivers a message now. Only the notifier calls it, after the gate allowed the message.
  deliver(message: NotifierMessage): void;
  // Keeps a learner's reply, for an adapter that shows the conversation.
  received(reply: InboundReply): void;
};

export type ReplyResult = { opted_out: boolean; confirmed: boolean };

// What the consent screen (#24) sets: messages on or off, quiet hours, and how the coach writes.
export type ConsentChoice = {
  messages: boolean;
  quiet_hours: Consent["quiet_hours"];
  intensity: Consent["intensity"];
};

// Matching ignores case, tashkeel, tatweel, alef forms, punctuation and polite words. As with SMS
// and WhatsApp opt-out keywords, what is left must be the stop word: a sentence that mentions
// stopping («توقف الفيديو عندي») is a reply, while «توقف من فضلك» is a stop.
const STOP_VERBS = [
  "stop",
  "unsubscribe",
  "توقف",
  "توقفي",
  "توقفوا",
  "وقف",
  "وقفي",
  "وقفوا",
  "ايقاف",
  "اوقف",
  "اوقفي",
  "اوقفوا",
];
const STOP_OBJECTS = ["", "messages", "الرسائل", "عن الرسائل"];

const POLITE = ["من فضلك", "لو سمحت", "لو سمحتي", "لو سمحتم", "رجاء", "please", "pls", "plz"];

export function normalizeReply(text: string): string {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ً-ٰٟۖ-ۭ]/g, "")
      .replace(/ـ/g, "")
      .replace(/[أإآٱ]/g, "ا")
      // Gulf and everyday spelling: «الرسايل» for «الرسائل», «على» written with ى.
      .replace(/[ئى]/g, "ي")
      .replace(/[\p{P}\p{S}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const STOP_WORDS = new Set(
  STOP_VERBS.flatMap((verb) => STOP_OBJECTS.map((object) => normalizeReply(`${verb} ${object}`))),
);

export function isStopWord(text: string): boolean {
  let padded = ` ${normalizeReply(text)} `;
  for (const word of POLITE) {
    while (padded.includes(` ${word} `)) padded = padded.replace(` ${word} `, " ");
  }
  return STOP_WORDS.has(padded.trim());
}

const CONFIRMATION_AR = "أوقفنا رسائل المدرب كما طلبت، ولن تصلك منه رسائل أخرى.";

export const CONSENT_DOC = "consent";
export const OUTBOX_DOC = "outbox";

export type NotifierOptions = {
  store: Store;
  sessionId: string;
  adapter: NotifierAdapter;
  tracer: Tracer;
  // The learner's consent before any change: the seed's.
  initialConsent: Consent;
};

export function createNotifier({
  store,
  sessionId,
  adapter,
  tracer,
  initialConsent,
}: NotifierOptions) {
  const consent = () => store.readDoc<Consent>(sessionId, CONSENT_DOC) ?? initialConsent;
  const outbox = () => store.readDoc<OutboxEntry[]>(sessionId, OUTBOX_DOC) ?? [];
  const saveOutbox = (entries: OutboxEntry[]) => store.writeDoc(sessionId, OUTBOX_DOC, entries);
  const learner = initialConsent.learner_id;
  const trace = (at: SimTime, summary_ar: string, summary_en: string) =>
    tracer.emit({ agent: "notifier", kind: "decision", at, summary_ar, summary_en });

  // An opt-out cancels every message still waiting for quiet hours to end.
  const cancelDeferred = () =>
    saveOutbox(
      outbox().map(
        (e): OutboxEntry =>
          e.status === "deferred"
            ? { message: e.message, status: "suppressed_opt_out", deliver_at: null }
            : e,
      ),
    );

  // The only path to the adapter.
  const dispatch = (message: NotifierMessage, at: SimTime, kind: MessageKind) => {
    const decision = gate(consent(), at, kind);
    if (decision.status === "send") adapter.deliver({ ...message, sim_ts: formatSimTime(at) });
    return decision;
  };

  const resultOf = (message: NotifierMessage, at: SimTime, kind: MessageKind): SendResult => {
    const decision = dispatch(message, at, kind);
    switch (decision.status) {
      case "send":
        return { status: "sent", deliver_at: formatSimTime(at) };
      case "deferred":
        return { status: "deferred", deliver_at: formatSimTime(decision.deliver_at) };
      case "suppressed_opt_out":
        return { status: "suppressed_opt_out", deliver_at: null };
    }
  };

  const traceResult = (entry: OutboxEntry, at: SimTime, deferredBefore: boolean) => {
    const { template, to } = entry.message;
    const reason = consent().opted_out ? "opted out" : "no consent";
    const reasonAr = consent().opted_out ? "أوقف الرسائل بطلبه" : "لم يوافق على الرسائل";
    switch (entry.status) {
      case "sent":
        return trace(
          at,
          deferredBefore
            ? `وصلت رسالة المدرب المؤجلة إلى ${to} بعد ساعات الهدوء`
            : `أُرسلت رسالة المدرب إلى ${to}`,
          `${deferredBefore ? "Delivered deferred" : "Sent"} ${template} to ${to} via ${entry.message.channel}`,
        );
      case "deferred":
        return trace(
          at,
          `أُجّلت رسالة المدرب إلى ${to} حتى تنتهي ساعات الهدوء: ${arabicSimTime(parseSimTime(entry.deliver_at))}`,
          `Deferred ${template} for ${to}: quiet hours until ${entry.deliver_at}`,
        );
      case "suppressed_opt_out":
      case "suppressed_quiet_hours":
        return trace(
          at,
          `لم تُرسل رسالة المدرب إلى ${to}، لأنه ${reasonAr}`,
          `Suppressed ${template} for ${to}: ${reason}`,
        );
    }
  };

  // Delivers, oldest first, each deferred message whose time has come by `upTo`, asking the gate
  // again at its delivery time. Returns the entries it settled.
  const deliverDue = (upTo: SimTime): OutboxEntry[] => {
    const entries = outbox();
    const due: { index: number; at: SimTime }[] = [];
    entries.forEach((e, index) => {
      if (e.status !== "deferred") return;
      const at = parseSimTime(e.deliver_at);
      if (compareSimTime(at, upTo) <= 0) due.push({ index, at });
    });
    due.sort((a, b) => compareSimTime(a.at, b.at));
    return due.map(({ index, at }) => {
      const entry = entries[index] as OutboxEntry;
      const next: OutboxEntry = {
        message: entry.message,
        ...resultOf(entry.message, at, "coach"),
      };
      entries[index] = next;
      saveOutbox(entries);
      traceResult(next, at, true);
      return next;
    });
  };

  // New quiet hours hold each waiting message until their end instead, or let it go now when they
  // have ended.
  const regateDeferred = (at: SimTime) => {
    const quiet = consent().quiet_hours;
    saveOutbox(
      outbox().map(
        (e): OutboxEntry =>
          e.status === "deferred"
            ? { ...e, deliver_at: formatSimTime(quietUntil(quiet, at) ?? at) }
            : e,
      ),
    );
    deliverDue(at);
  };

  return {
    consent,
    outbox,
    capabilities: () => adapter.capabilities(),

    send(message: NotifierMessage): SendResult {
      const sent = outbox().find((e) => e.message.id === message.id);
      if (sent) {
        const { message: _, ...result } = sent;
        return result;
      }
      const { max_text_length } = adapter.capabilities();
      if (message.text_ar.length > max_text_length) {
        throw new Error(`Message ${message.id} is longer than ${max_text_length} characters`);
      }
      const at = parseSimTime(message.sim_ts);
      const entry: OutboxEntry = { message, ...resultOf(message, at, "coach") };
      saveOutbox([...outbox(), entry]);
      traceResult(entry, at, false);
      const { message: _, ...result } = entry;
      return result;
    },

    deliverDue,

    // The consent screen's save. Turning messages off is an opt-out like a stop word, without the
    // confirmation message, since the learner is on the screen that says so; turning them on grants
    // consent, keeping the day it was first granted.
    setConsent(choice: ConsentChoice, at: SimTime): Consent {
      const before = consent();
      const next: Consent = {
        ...before,
        quiet_hours: choice.quiet_hours,
        intensity: choice.intensity,
        ...(choice.messages
          ? {
              granted: true,
              granted_sim_day: before.granted_sim_day ?? at.day,
              opted_out: false,
              opted_out_sim_day: null,
            }
          : {
              opted_out: true,
              opted_out_sim_day: before.opted_out ? before.opted_out_sim_day : at.day,
            }),
      };
      store.writeDoc(sessionId, CONSENT_DOC, next);
      if (!choice.messages) cancelDeferred();
      else regateDeferred(at);
      const quiet = next.quiet_hours;
      trace(
        at,
        `حدّث ${learner} حدود المتابعة: الرسائل ${choice.messages ? "مفعّلة" : "متوقفة"}، ${quiet ? `الهدوء من ${quiet.start} حتى ${quiet.end}` : "بلا ساعات هدوء"}، بأسلوب ${next.intensity === "gentle" ? "لطيف" : "عادي"}`,
        `Consent saved by ${learner}: messages ${choice.messages ? "on" : "off"}, quiet hours ${quiet ? `${quiet.start}-${quiet.end}` : "none"}, intensity ${next.intensity}`,
      );
      return next;
    },

    // The inbound reply handler. A stop word opts out at once, whatever the state; the first one
    // also cancels deferred messages and sends one confirmation.
    receive(text: string, at: SimTime): ReplyResult {
      adapter.received({ from: learner, text, sim_ts: formatSimTime(at) });
      if (!isStopWord(text)) {
        trace(at, `وصل ردّ من ${learner}`, `Reply from ${learner}`);
        return { opted_out: consent().opted_out, confirmed: false };
      }
      const before = consent();
      if (before.opted_out) {
        trace(
          at,
          `وصلت كلمة إيقاف من ${learner}، والرسائل متوقفة من قبل`,
          `Stop word from ${learner}: already opted out, no second confirmation`,
        );
        return { opted_out: true, confirmed: false };
      }

      store.writeDoc(sessionId, CONSENT_DOC, {
        ...before,
        opted_out: true,
        opted_out_sim_day: at.day,
      } satisfies Consent);
      cancelDeferred();
      trace(
        at,
        `أوقف ${learner} الرسائل بكلمة إيقاف، فأُلغيت كل رسالة مؤجلة`,
        `Stop word from ${learner}: opted out; deferred messages cancelled`,
      );

      const confirmation: NotifierMessage = {
        id: `opt_out_${toMinutes(at)}`,
        to: learner,
        channel: adapter.capabilities().channel,
        template: "opt_out_confirmation",
        text_ar: CONFIRMATION_AR,
        cta: null,
        sim_ts: formatSimTime(at),
      };
      dispatch(confirmation, at, "opt_out_confirmation");
      trace(at, `أُرسل تأكيد الإيقاف إلى ${learner}`, `Sent the opt-out confirmation to ${learner}`);
      return { opted_out: true, confirmed: true };
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
