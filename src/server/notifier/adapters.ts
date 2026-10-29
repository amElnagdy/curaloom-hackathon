// Notifier adapters, chosen by NOTIFIER_ADAPTER (src/config.ts). Only the simulated adapter
// delivers anything, and only into the session store, where the coach page's phone reads it. The
// codebase makes no network sends to learners (ADR-004).

import type { NotifierAdapterName } from "../../config.ts";
import { parseSimTime, toMinutes } from "../clock/time.ts";
import type { Store } from "../store/store.ts";
import type { Cta, InboundReply, NotifierAdapter, OutboxEntry } from "./notifier.ts";

// One line on the simulated phone: a message the learner received, or one he sent.
export type InboxEntry = {
  id: string;
  direction: "out" | "in";
  text: string;
  cta: Cta | null;
  // The message's template; null for the learner's own replies.
  template: string | null;
  // When the phone received or sent it.
  sim_ts: string;
};

const INBOX_DOC = "inbox";

export function readInbox(store: Store, sessionId: string): InboxEntry[] {
  return store.readDoc<InboxEntry[]>(sessionId, INBOX_DOC) ?? [];
}

function createSimulatedAdapter(store: Store, sessionId: string): NotifierAdapter {
  const append = (entry: InboxEntry) =>
    store.writeDoc(sessionId, INBOX_DOC, [...readInbox(store, sessionId), entry]);
  return {
    capabilities: () => ({ channel: "simulated", cta: true, replies: true, max_text_length: 1000 }),
    deliver: (message) =>
      append({
        id: message.id,
        direction: "out",
        text: message.text_ar,
        cta: message.cta,
        template: message.template,
        sim_ts: message.sim_ts,
      }),
    received: (reply: InboundReply) =>
      append({
        id: `in_${readInbox(store, sessionId).length + 1}`,
        direction: "in",
        text: reply.text,
        cta: null,
        template: null,
        sim_ts: reply.sim_ts,
      }),
  };
}

// A real channel is a later decision. Each stub documents what its adapter must do, and throws.
function stub(channel: NotifierAdapterName, duties: string): NotifierAdapter {
  const fail = (): never => {
    throw new Error(
      `The ${channel} notifier adapter is a documented stub and sends nothing; set NOTIFIER_ADAPTER=simulated. A real one must: ${duties}`,
    );
  };
  return { capabilities: fail, deliver: fail, received: fail };
}

const ADAPTERS: Record<NotifierAdapterName, (store: Store, sessionId: string) => NotifierAdapter> =
  {
    simulated: createSimulatedAdapter,
    whatsapp: () =>
      stub(
        "whatsapp",
        "look up the learner's number from the learner id outside the notifier; send business-initiated messages only as pre-approved templates; turn inbound webhook messages into notifier.receive() calls so stop words keep working; keep numbers out of traces.",
      ),
    email: () =>
      stub(
        "email",
        "look up the learner's address from the learner id outside the notifier; add an unsubscribe link and a List-Unsubscribe header, and turn them and replies into notifier.receive() calls; keep addresses out of traces.",
      ),
  };

export function createAdapter(
  name: NotifierAdapterName,
  store: Store,
  sessionId: string,
): NotifierAdapter {
  return ADAPTERS[name](store, sessionId);
}

// The simulated phone's conversation, by sim time: messages received (noting any that quiet hours
// held back), the learner's replies, messages still held, and messages that never went.
export type ThreadItem =
  | {
      kind: "received";
      id: string;
      text: string;
      cta: Cta | null;
      at: string;
      held_from: string | null;
    }
  | { kind: "sent"; id: string; text: string; at: string }
  | { kind: "held"; id: string; text: string; at: string; until: string }
  | { kind: "suppressed"; id: string; at: string };

export function phoneThread(inbox: InboxEntry[], outbox: OutboxEntry[]): ThreadItem[] {
  const sentAt = new Map(outbox.map((e) => [e.message.id, e.message.sim_ts]));
  const items = inbox.map((e): ThreadItem => {
    if (e.direction === "in") return { kind: "sent", id: e.id, text: e.text, at: e.sim_ts };
    const from = sentAt.get(e.id);
    return {
      kind: "received",
      id: e.id,
      text: e.text,
      cta: e.cta,
      at: e.sim_ts,
      held_from: from !== undefined && from !== e.sim_ts ? from : null,
    };
  });
  for (const entry of outbox) {
    const { id, text_ar, sim_ts } = entry.message;
    if (entry.status === "deferred") {
      items.push({ kind: "held", id, text: text_ar, at: sim_ts, until: entry.deliver_at });
    } else if (entry.status !== "sent") {
      items.push({ kind: "suppressed", id, at: sim_ts });
    }
  }
  const minutes = (item: ThreadItem) => toMinutes(parseSimTime(item.at));
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => minutes(a.item) - minutes(b.item) || a.order - b.order)
    .map(({ item }) => item);
}
