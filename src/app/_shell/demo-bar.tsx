"use client";

// The demo bar (#23, prototype C on prototype/23-demo-bar): a day timeline docked at the bottom
// of the page column. Each coach rung is a marker that turns ready once the clock passes it; a
// marker ahead jumps the clock to its day. Demo machinery, so it collapses to a chip.
// Until the viewer chooses, it renders both and CSS picks one: open on a wide screen, the chip on a
// phone (#35). Choosing in JS after mount would flash the open bar on a phone first.
// Between the intake and the learner's plan, the controls that move the clock forward are off and
// say why (#61); reset stays on.

import { ChevronDown, FlaskConical, Plus, RotateCcw } from "lucide-react";
import { type CSSProperties, useEffect, useId, useState } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import type { ProviderProfile } from "../../config.ts";
import { compareSimTime, type SimTime, startOfDay } from "../../server/clock/time.ts";
import { COACH_TITLE, simDay, simTimeText } from "./course.ts";
import styles from "./demo-bar.module.css";
import { arabicNumber } from "./format.ts";
import { buttonClass, cx, ModeBadge } from "./ui.tsx";
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

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => {
    document.documentElement.dataset.demoBar = shown;
    return () => {
      delete document.documentElement.dataset.demoBar;
    };
  }, [shown]);

  const toggle = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  async function run(m: Parameters<typeof move>[0]) {
    const outcome = await move(m);
    setNote(outcome.kind === "failed" ? "تعذّر تحريك الساعة." : null);
  }

  const chip = (
    <button
      type="button"
      className={styles.chip}
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
      <ModeBadge profile={profile} />
    </button>
  );
  if (collapsed) {
    return (
      <div className={styles.dock} data-shown={shown}>
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
    <div className={styles.dock} data-shown={shown}>
      {collapsed === null && chip}
      <section className={styles.bar} aria-label="أداة العرض">
        <header className={styles.head}>
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
              {...waits}
              onClick={() => run({ action: "advance", body: { days: 1 } })}
            >
              <Plus aria-hidden />
              يوم
            </button>
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              disabled={still}
              onClick={() => run({ action: "reset" })}
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
