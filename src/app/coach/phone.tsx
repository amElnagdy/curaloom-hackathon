"use client";

// The simulated phone's live parts (#22): the reply field and the stop button, which post to
// POST /api/sessions/:id/inbox, and a refresh whenever the clock or the notifier acts in any tab.

import { OctagonX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTrace } from "../_shell/trace-provider.tsx";
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
