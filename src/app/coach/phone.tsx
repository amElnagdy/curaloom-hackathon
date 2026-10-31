"use client";

// The simulated phone's live parts (#22): the reply field, the stop button and the check-in's
// buttons (#25), which post to POST /api/sessions/:id/inbox, and a refresh whenever the clock or the
// notifier acts in any tab.

import { OctagonX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CheckinChoice } from "../../../contracts/index.ts";
import { useTrace } from "../_shell/trace-provider.tsx";
import { buttonClass } from "../_shell/ui.tsx";
import styles from "./coach.module.css";

const STOP_WORD = "توقف";

export function ReplyBox({ sessionId, optedOut }: { sessionId: string; optedOut: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(reply: string) {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/inbox`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: reply }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText("");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.compose}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send(text);
      }}
    >
      <button
        type="button"
        className={styles.stop}
        disabled={busy || optedOut}
        title={optedOut ? "الرسائل متوقفة بطلبك" : "أوقف رسائل المدرب"}
        onClick={() => send(STOP_WORD)}
      >
        <OctagonX aria-hidden />
        توقف
      </button>
      <input
        className={styles.field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        maxLength={1000}
        placeholder="اكتب ردّك"
        aria-label="ردّك على المدرب"
        aria-invalid={failed || undefined}
        enterKeyHint="send"
      />
      <span className="sr-only" role="status">
        {failed ? "تعذّر إرسال الرد." : ""}
      </span>
    </form>
  );
}

// The check-in's choices under its bubble. A tap answers it once: the chosen button stays pressed and
// the others go off. `chosen` is the answer the server holds; until the page refreshes with it, the
// tap just sent shows instead.
export function CheckinButtons({
  sessionId,
  eventId,
  options,
  chosen,
  disabled,
}: {
  sessionId: string;
  eventId: string;
  options: { choice: CheckinChoice; label_ar: string }[];
  chosen: CheckinChoice | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const [sent, setSent] = useState<CheckinChoice | null>(null);
  const [failed, setFailed] = useState(false);
  const pressed = chosen ?? sent;

  async function choose(choice: CheckinChoice) {
    setSent(choice);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/inbox`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_id: eventId, choice }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setSent(null);
      setFailed(true);
    }
    // A refused tap is one the server knows better: answered in another tab, or messages stopped.
    router.refresh();
  }

  return (
    <fieldset className={styles.choices}>
      <legend className="sr-only">ردّك على سؤال المدرب</legend>
      {options.map(({ choice, label_ar }) => (
        <button
          key={choice}
          type="button"
          className={buttonClass("secondary", "sm")}
          aria-pressed={pressed === choice}
          aria-disabled={pressed === choice || undefined}
          disabled={disabled || (pressed !== null && pressed !== choice)}
          onClick={() => {
            if (pressed === null) choose(choice);
          }}
        >
          {label_ar}
        </button>
      ))}
      <span className={failed ? styles.choiceError : "sr-only"} role="status">
        {failed ? "تعذّر إرسال اختيارك. حاول مرة أخرى." : ""}
      </span>
    </fieldset>
  );
}

// Re-renders the page when an event from the clock or the notifier arrives after the history
// replayed, so the phone and the queue follow moves made from Settings in another tab.
export function RefreshOnCoachEvents() {
  const router = useRouter();
  const { events, replayed } = useTrace();
  const latest = replayed
    ? events.findLast((e) => (e.agent === "clock" || e.agent === "notifier") && !replayed.has(e.id))
        ?.id
    : undefined;
  useEffect(() => {
    if (latest) router.refresh();
  }, [latest, router]);
  return null;
}
