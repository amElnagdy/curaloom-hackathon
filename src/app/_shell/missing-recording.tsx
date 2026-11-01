"use client";

// When replay has no recording of a request or a page (#30), the recorded demo cannot go on down
// that path: the same request misses again on every retry. The banner under the top bar says so in
// plain Arabic and offers the way back, the demo's reset (#56). The request's hash stays in the
// trace drawer and the server log, for developers.

import { Logs, RotateCcw, TriangleAlert, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { TraceEvent } from "../../server/trace/trace.ts";
import styles from "./missing-recording.module.css";
import { useTrace } from "./trace-provider.tsx";
import { type ButtonSize, buttonClass } from "./ui.tsx";

// The step that stopped, in the learner's words, and the way back when a chip refills the recorded
// text on that page.
const STEP: Record<string, { name: string; back?: string }> = {
  intake: {
    name: "ردّ المحاور",
    back: "اضغط «املأ الرسالة المسجّلة» وأرسلها كما هي، أو ابدأ العرض من جديد.",
  },
  scout: { name: "البحث عن المصادر" },
  architect: { name: "تصميم الخطة" },
  lesson_builder: { name: "كتابة الدرس" },
  examiner: {
    name: "الاختبار",
    back: "اضغط «املأ الإجابة المسجّلة» وسلّم الإجابات كما هي، أو ابدأ العرض من جديد.",
  },
  diagrams: { name: "تعريب الرسوم" },
  coach: { name: "رسالة المدرب" },
  replanner: { name: "تعديل الخطة" },
};
const BACK = "ابدأ العرض من جديد واتبع الإجابات المسجّلة.";

// The plan page says itself why a build that missed cannot finish (plan/road.tsx).
const OWN_PAGE: Record<string, string> = { scout: "/plan", architect: "/plan" };

// The newest miss still in the way: none after the demo's reset, the only event of `sim`, and none
// once its agent has finished a step since.
export function blockingMiss(events: readonly TraceEvent[]): TraceEvent | undefined {
  const finished = new Set<string>();
  for (const event of events.toReversed()) {
    if (event.agent === "sim") return undefined;
    if (event.kind === "output") finished.add(event.agent);
    else if (event.missing_recording && !finished.has(event.agent)) return event;
  }
  return undefined;
}

// Whether `agent` has a miss still in the way, as the banner reads it: a retry of its step sends
// the same request and misses again.
export function stoppedOnMiss(events: readonly TraceEvent[], agent: string): boolean {
  return blockingMiss(events.filter((e) => e.agent === agent || e.agent === "sim")) !== undefined;
}

export function useStoppedOnMiss(agent: string): boolean {
  return stoppedOnMiss(useTrace().events, agent);
}

// The misses this tab is done with: dismissed, or restarted past.
const DISMISSED_KEY = "missing-recording-dismissed";
// A miss by when it happened, so ids that start again after `pnpm demo:reset` are not confused.
const missKey = (miss: TraceEvent) => `${miss.ts} ${miss.missing_recording}`;

export function dismissedMisses(): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(keys));
  } catch {
    // Storage blocked: the banner stays hidden until the page reloads.
  }
}

// The demo bar's «إعادة»: every document of the session goes, so the pages fall back to the seed
// and the interview starts empty; the trace stays. With the simulated clock off that route is off
// too, and forgetting the interview restarts the learner's path, but traces no reset (#82), so the
// misses so far are put aside in this tab as a dismissal is.
export async function restartDemo(
  sessionId: string,
  events: readonly TraceEvent[],
): Promise<boolean> {
  const post = (path: string) =>
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  const res = await post("sim/reset");
  const ok = (res.status === 404 ? await post("intake/reset") : res).ok;
  if (ok) {
    const misses = events.flatMap((event) => (event.missing_recording ? [missKey(event)] : []));
    writeDismissed([...dismissedMisses(), ...misses]);
  }
  return ok;
}

export function RestartDemoButton({ size = "md" }: { size?: ButtonSize }) {
  const { sessionId, events } = useTrace();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function restart() {
    setState("busy");
    // A full load, so every page and the trace stream start again from the reset.
    if (await restartDemo(sessionId, events).catch(() => false)) window.location.assign("/intake");
    else setState("failed");
  }

  return (
    <>
      <button
        type="button"
        className={buttonClass("primary", size)}
        onClick={restart}
        disabled={state === "busy"}
      >
        <RotateCcw aria-hidden />
        ابدأ العرض من جديد
      </button>
      {state === "failed" && (
        <span className={styles.note} role="status">
          تعذّرت إعادة العرض. حاول مرة أخرى.
        </span>
      )}
    </>
  );
}

// The trace drawer names the request that has no recording.
export function TraceDetailsButton({ size = "md" }: { size?: ButtonSize }) {
  const { openDrawer } = useTrace();
  return (
    <button type="button" className={buttonClass("secondary", size)} onClick={openDrawer}>
      <Logs aria-hidden />
      التفاصيل في سجل الوكلاء
    </button>
  );
}

// What has no recording, without guessing why: an answer off the recorded path, a page opened at
// another time, or a recording that was never made all look the same here (#86). A model call's
// miss carries its role; a page's (fetch-page.ts) does not.
const missing = (miss: TraceEvent) =>
  miss.role ? "هذا الجزء من العرض غير مسجّل" : "إحدى صفحات المصادر غير مسجّلة في العرض";

export function MissingRecordingNotice({
  miss,
  onDismiss,
}: {
  miss: TraceEvent;
  onDismiss(): void;
}) {
  const step = STEP[miss.agent];
  return (
    <section className={styles.banner} aria-labelledby="missing-recording-title">
      <div className={styles.message}>
        <TriangleAlert aria-hidden />
        <p className={styles.text} role="alert">
          <b id="missing-recording-title">
            {step ? `توقّف العرض عند ${step.name}.` : "توقّف العرض هنا."}
          </b>{" "}
          {missing(miss)}، فلن تنجح إعادة المحاولة. {step?.back ?? BACK}
        </p>
      </div>
      <div className={styles.actions}>
        <RestartDemoButton size="sm" />
        <TraceDetailsButton size="sm" />
        <button
          type="button"
          className={buttonClass("ghost", "sm", { iconOnly: true, className: styles.dismiss })}
          aria-label="أخفِ هذا التنبيه"
          onClick={onDismiss}
        >
          <X aria-hidden />
        </button>
      </div>
    </section>
  );
}

// The miss the banner shows on `pathname`: none on the page that already explains it, and none
// once the viewer dismissed it or restarted the demo past it.
export function bannerMiss(
  events: readonly TraceEvent[],
  pathname: string,
  dismissed: readonly string[],
): TraceEvent | undefined {
  const miss = blockingMiss(events);
  if (!miss || dismissed.includes(missKey(miss)) || OWN_PAGE[miss.agent] === pathname) return;
  return miss;
}

// Under the top bar on every page, once per miss.
export function MissingRecordingAlert() {
  const { events } = useTrace();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(dismissedMisses()), []);

  const miss = bannerMiss(events, pathname, dismissed);
  if (!miss) return null;

  const dismiss = () => {
    const next = [...dismissed, missKey(miss)];
    setDismissed(next);
    writeDismissed(next);
    // The button goes with the banner; focus moves to the page.
    document.getElementById("main")?.focus();
  };
  return <MissingRecordingNotice miss={miss} onDismiss={dismiss} />;
}
