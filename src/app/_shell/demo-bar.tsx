"use client";

// The demo bar (#23, prototype C on prototype/23-demo-bar): a day timeline docked at the bottom
// of the page column. Each coach rung is a marker that turns ready once the clock passes it; a
// marker ahead jumps the clock to its day. Demo machinery, so it collapses to a chip.
// Until the viewer chooses, it renders both and CSS picks one: open on a roomy screen, the chip on a
// phone (#35) or a short screen (#66). Choosing in JS after mount would flash the open bar first.
// Between the intake and the learner's plan, the controls that move the clock forward are off and
// say why (#61); reset stays on. Reset empties the session's data, so it asks first (#66).

import { ChevronDown, FlaskConical, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type CSSProperties, type RefObject, useEffect, useId, useRef, useState } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import type { ProviderProfile } from "../../config.ts";
import { compareSimTime, type SimTime, startOfDay } from "../../server/clock/time.ts";
import { COACH_TITLE, simDay, simTimeText } from "./course.ts";
import styles from "./demo-bar.module.css";
import { arabicNumber } from "./format.ts";
import { ModeBadge } from "./mode-badge.tsx";
import { buttonClass, cx } from "./ui.tsx";
import { useSimClock, WAITS_FOR_PLAN } from "./use-sim-clock.ts";

export type DemoMark = { day: number; type: CoachEvent["type"] };

const SHORT: Record<CoachEvent["type"], string> = {
  nudge: "تذكير",
  checkin: "سؤال",
  replan: "أسبوع أخف",
  weekly: "أسبوعية",
  comeback: "عودة",
};

const STORAGE_KEY = "demo-bar";
const MIN_SPAN = 17;

// The viewer's saved choice, or null for none.
function readCollapsed(): boolean | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? null : saved === "collapsed";
  } catch {
    return null;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "open");
  } catch {}
}

// The room the dock takes over the page, as --demo-bar-h (globals.css), so full-height columns and
// sticky actions end above it. Measured, since zoom, wrapping and the reset question change it. A
// dock in the page's flow (the chip on a phone) takes none.
function useDockRoom(dock: RefObject<HTMLDivElement | null>, shown: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dock's children change with `shown`
  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => {
      const style = getComputedStyle(el);
      const visible = [...el.children].find((child) => child.getClientRects().length > 0);
      const room =
        style.position === "sticky" && visible
          ? visible.getBoundingClientRect().height + Number.parseFloat(style.bottom)
          : 0;
      root.style.setProperty("--demo-bar-h", `${Math.ceil(room)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--demo-bar-h");
    };
  }, [dock, shown]);
}

// How far along the track a time sits, 0 to 100.
const percent = (t: SimTime, span: number) =>
  Math.min(100, ((t.day + t.minute / 1440) / span) * 100);

export function DemoBar({
  sessionId,
  learnerName,
  marks,
  profile,
}: {
  sessionId: string;
  learnerName: string;
  marks: DemoMark[];
  // Whether the models answer live or from recordings, shown open or collapsed (#30).
  profile: ProviderProfile;
}) {
  const { now, busy, move, waitsForPlan } = useSimClock(sessionId);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const waitsId = useId();
  const [note, setNote] = useState<string | null>(null);
  const shown = collapsed === null ? "auto" : collapsed ? "collapsed" : "open";
  const dockRef = useRef<HTMLDivElement>(null);
  useDockRoom(dockRef, shown);

  // The reset question, the coach phone's confirm row (#66): focus starts on «تراجع», and Esc,
  // «تراجع» or a reset gives it back to «إعادة».
  const [confirming, setConfirming] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const askId = useId();
  const resetRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
      return;
    }
    if (refocus.current) resetRef.current?.focus({ preventScroll: true });
    refocus.current = false;
  }, [confirming]);
  // The confirm button is off while the reset is sent, which drops its focus; a failure gives it back.
  useEffect(() => {
    if (resetFailed && confirming) confirmRef.current?.focus();
  }, [resetFailed, confirming]);

  const toggle = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  async function run(m: Parameters<typeof move>[0]) {
    const outcome = await move(m);
    setNote(outcome.kind === "failed" ? "تعذّر تحريك الساعة." : null);
  }

  function closeConfirm() {
    refocus.current = true;
    setResetFailed(false);
    setConfirming(false);
  }

  async function reset() {
    setResetFailed(false);
    const outcome = await move({ action: "reset" });
    if (outcome.kind === "failed") {
      setResetFailed(true);
      return;
    }
    setNote(null);
    closeConfirm();
    // The page on screen still shows the erased plan or lesson until the server renders it again.
    router.refresh();
  }

  // The badge is a button of its own, so it sits beside the chip's button, not in it.
  const chip = (
    <div className={styles.chip}>
      <button
        type="button"
        className={styles.chipOpen}
        onClick={() => toggle(false)}
        aria-label="أظهر أداة العرض"
      >
        <FlaskConical aria-hidden />
        أداة العرض
        {now && (
          <>
            <span className={styles.sep} aria-hidden />
            {simDay(now.day)}
          </>
        )}
      </button>
      <ModeBadge profile={profile} />
    </div>
  );
  if (collapsed) {
    return (
      <div ref={dockRef} className={styles.dock} data-shown={shown}>
        {chip}
      </div>
    );
  }

  const span = Math.max(MIN_SPAN, now?.day ?? 0, ...marks.map((m) => m.day));
  const passed = (day: number) => now !== null && compareSimTime(startOfDay(day), now) <= 0;
  const at = now ? percent(now, span) : 0;
  const still = busy || now === null;
  const waits = waitsForPlan ? { "aria-describedby": waitsId, title: WAITS_FOR_PLAN } : {};

  return (
    <div ref={dockRef} className={styles.dock} data-shown={shown}>
      {collapsed === null && chip}
      <section className={styles.bar} aria-label="أداة العرض">
        <header className={styles.head}>
          {confirming ? (
            <fieldset
              className={styles.confirm}
              aria-labelledby={askId}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeConfirm();
              }}
            >
              <p id={askId}>
                أتريد أن تبدأ العرض من الصفر؟ تُمحى المقابلة والخطة والدروس ورسائل المدرب، وتعود
                الساعة إلى يوم البدء.
              </p>
              {resetFailed && (
                <p className={styles.confirmError} role="alert">
                  تعذّرت إعادة العرض. حاول مرة أخرى.
                </p>
              )}
              <button
                ref={confirmRef}
                type="button"
                className={buttonClass("secondary", "sm")}
                disabled={busy}
                onClick={reset}
              >
                نعم، ابدأ من الصفر
              </button>
              <button
                ref={cancelRef}
                type="button"
                className={buttonClass("ghost", "sm")}
                disabled={busy}
                onClick={closeConfirm}
              >
                تراجع
              </button>
            </fieldset>
          ) : (
            <>
              <h2 className={styles.title}>
                <FlaskConical aria-hidden />
                أيام {learnerName} بلا دراسة
              </h2>
              <ModeBadge profile={profile} />
              {now && (
                <span className={styles.now} role="timer">
                  {simTimeText(now)}
                </span>
              )}
              {waitsForPlan && (
                <span id={waitsId} className={styles.waits} title={WAITS_FOR_PLAN}>
                  {WAITS_FOR_PLAN}
                </span>
              )}
              <div className={styles.controls}>
                <button
                  type="button"
                  className={buttonClass("primary", "sm")}
                  disabled={still || waitsForPlan}
                  title="يقدّم ساعة المحاكاة يومًا، ويرسل المدرب ما حلّ موعده"
                  {...waits}
                  onClick={() => run({ action: "advance", body: { days: 1 } })}
                >
                  <Plus aria-hidden />
                  قدّم يومًا
                </button>
                <button
                  ref={resetRef}
                  type="button"
                  className={buttonClass("ghost", "sm")}
                  disabled={still}
                  onClick={() => setConfirming(true)}
                >
                  <RotateCcw aria-hidden />
                  إعادة
                </button>
                <button
                  type="button"
                  className={buttonClass("ghost", "sm")}
                  onClick={() => toggle(true)}
                  aria-label="أخفِ أداة العرض"
                >
                  <ChevronDown aria-hidden />
                </button>
              </div>
            </>
          )}
        </header>
        <ol className={styles.track} style={{ "--at": `${at}%` } as CSSProperties}>
          <li className={styles.rail} aria-hidden />
          {marks.map((m) => {
            const done = passed(m.day);
            const label = `${simDay(m.day)}: ${COACH_TITLE[m.type]}`;
            return (
              <li
                key={`${m.day}-${m.type}`}
                className={cx(styles.mark, done && styles.done)}
                style={{ "--pos": `${(m.day / span) * 100}%` } as CSSProperties}
              >
                <button
                  type="button"
                  className={styles.pin}
                  disabled={done || still || waitsForPlan}
                  {...waits}
                  aria-label={done ? `${label}، حلّ موعدها` : `انتقل إلى ${label}`}
                  onClick={() => run({ action: "set", body: { day: m.day } })}
                >
                  <span className={styles.dot} aria-hidden />
                </button>
                <span className={styles.caption} aria-hidden>
                  <span className={styles.long}>
                    {simDay(m.day)}، {SHORT[m.type]}
                  </span>
                  <span className={styles.short}>{arabicNumber(m.day)}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {note && (
          <p className={styles.note} role="status">
            {note}
          </p>
        )}
      </section>
    </div>
  );
}
