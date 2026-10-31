"use client";

// The comeback's client side on the plan page (#27, #26). DetectOnOpen tells the coach the learner
// is back, once, when the page finds a comeback due: the only write tied to opening the app.
// ReplanNow finishes a comeback with no recap, for a learner who has passed no lesson yet.
// ProposalActions answers the re-planner's proposal. Each asks the server, then draws the page
// again, so the plan page shows what the server now holds.

import { Check, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass } from "../_shell/ui.tsx";
import styles from "./comeback.module.css";

const post = (sessionId: string, path: string, body: object) =>
  fetch(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const FAILED = "تعذّر ذلك هذه المرة. حاول مرة أخرى بعد قليل.";

export function DetectOnOpen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // The page drawn on a due comeback already shows its recap; only a 409, no comeback due after
    // all, changes what it should show.
    post(sessionId, "comeback/open", {})
      .then((res) => {
        if (res.status === 409) router.refresh();
      })
      .catch(() => {});
  }, [sessionId, router]);
  return null;
}

// One request whose success draws the page again; a 409 means the page is out of date, so it is
// drawn again too.
function useStep(sessionId: string) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const run = async (path: string, body: object, onDone?: () => void) => {
    setSending(true);
    setFailed(false);
    try {
      const res = await post(sessionId, path, body);
      if (res.ok || res.status === 409) {
        onDone?.();
        startTransition(() => router.refresh());
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };
  return { run, busy: sending || refreshing, failed };
}

// The proposal takes this button's place; focus moves to the proposal's title, `focusId`.
export function ReplanNow({ sessionId, focusId }: { sessionId: string; focusId: string }) {
  const { run, busy, failed } = useStep(sessionId);
  const done = useRef(false);
  useEffect(
    () => () => {
      if (!done.current) return;
      const title = document.getElementById(focusId);
      title?.focus({ preventScroll: true });
      title?.closest("section")?.scrollIntoView({ block: "start" });
    },
    [focusId],
  );
  return (
    <div className={styles.replanNow}>
      <button
        type="button"
        className={buttonClass("primary", "lg")}
        disabled={busy}
        onClick={() =>
          run("comeback/replan", {}, () => {
            done.current = true;
          })
        }
      >
        {busy ? "نرتّب خطتك…" : "رتّب خطتي"}
      </button>
      {failed && (
        <p className={styles.failed} role="alert">
          <TriangleAlert aria-hidden />
          {FAILED}
        </p>
      )}
    </div>
  );
}

// The proposal goes once it is answered, and these buttons with it. Focus then moves to the page's
// title, which stays, and the page scrolls back to the top, where the plan in force now begins.
export function ProposalActions({ sessionId, version }: { sessionId: string; version: number }) {
  const { run, busy, failed } = useStep(sessionId);
  const answered = useRef(false);
  useEffect(
    () => () => {
      if (!answered.current) return;
      document.getElementById("plan-title")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    },
    [],
  );
  const answer = (action: "accept" | "reject") =>
    run(`plan/${action}`, { version }, () => {
      answered.current = true;
    });
  return (
    <>
      {failed && (
        <p className={styles.failed} role="alert">
          <TriangleAlert aria-hidden />
          {FAILED}
        </p>
      )}
      <div className={styles.decideBtns}>
        <button
          type="button"
          className={buttonClass("secondary")}
          disabled={busy}
          onClick={() => answer("reject")}
        >
          أبقِ خطتي الحالية
        </button>
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={busy}
          onClick={() => answer("accept")}
        >
          <Check aria-hidden />
          اعتمد الخطة الجديدة
        </button>
      </div>
    </>
  );
}
