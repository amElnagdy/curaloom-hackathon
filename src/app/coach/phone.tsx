"use client";

// The simulated phone's live parts (#22): the reply field, the stop button and the check-in's
// buttons (#25), which post to POST /api/sessions/:id/inbox, and a refresh whenever the clock or the
// notifier acts in any tab.

import { OctagonX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { CheckinChoice } from "../../../contracts/index.ts";
import type { ConsentState } from "../_shell/course.ts";
import { useTrace } from "../_shell/trace-provider.tsx";
import { buttonClass } from "../_shell/ui.tsx";
import styles from "./coach.module.css";

const STOP_WORD = "توقف";

// The stop button asks before it stops the messages (#61); a typed «توقف» stops them at once, as a
// stop word does over SMS (ADR-004). A stop that fails keeps the row open and says so (#92).
export function ReplyBox({ sessionId, consent }: { sessionId: string; consent: ConsentState }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const askId = useId();
  const stopRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Where focus goes when the confirm row closes: back to «توقف», or to the field once stopped.
  const refocus = useRef<"stop" | "field" | null>(null);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
      return;
    }
    const to = refocus.current;
    refocus.current = null;
    if (to) (to === "stop" ? stopRef : fieldRef).current?.focus({ preventScroll: true });
  }, [confirming]);

  // The confirm button is off while the stop is sent, which drops its focus; a failure gives it back.
  useEffect(() => {
    if (failed && confirming) confirmRef.current?.focus();
  }, [failed, confirming]);

  function open() {
    setFailed(false);
    setConfirming(true);
  }

  function close(to: "stop" | "field") {
    refocus.current = to;
    setFailed(false);
    setConfirming(false);
  }

  // Whether the server took the reply.
  async function send(reply: string): Promise<boolean> {
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
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {confirming ? (
        <fieldset
          className={styles.confirm}
          aria-labelledby={askId}
          onKeyDown={(e) => {
            if (e.key === "Escape") close("stop");
          }}
        >
          <p id={askId}>
            {/* Messages that were never on cannot be turned back on, only agreed to. */}
            {consent === "not_asked"
              ? "أتريد إيقاف رسائل المدرب؟ توافق عليها متى شئت من صفحة حدودك."
              : "أتريد إيقاف رسائل المدرب؟ تعيد تفعيلها متى شئت من صفحة حدودك."}
          </p>
          {failed && (
            <p className={styles.confirmError} role="alert">
              تعذّر إيقاف الرسائل. حاول مرة أخرى.
            </p>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={buttonClass("secondary", "sm")}
            disabled={busy}
            onClick={async () => {
              if (await send(STOP_WORD)) close("field");
            }}
          >
            نعم، أوقفها
          </button>
          <button
            ref={cancelRef}
            type="button"
            className={buttonClass("ghost", "sm")}
            disabled={busy}
            onClick={() => close("stop")}
          >
            تراجع
          </button>
        </fieldset>
      ) : (
        <form
          className={styles.compose}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send(text);
          }}
        >
          <button
            ref={stopRef}
            type="button"
            className={styles.stop}
            disabled={busy || consent === "stopped"}
            title={consent === "stopped" ? "الرسائل متوقفة بطلبك" : "أوقف رسائل المدرب"}
            onClick={open}
          >
            <OctagonX aria-hidden />
            توقف
          </button>
          <input
            ref={fieldRef}
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
        </form>
      )}
      <span className="sr-only" role="status">
        {failed && !confirming ? "تعذّر إرسال الرد." : ""}
      </span>
    </>
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
