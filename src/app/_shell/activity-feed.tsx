"use client";

// «ما يحدث الآن» (#15): the learner's view of agent work, one plain-Arabic line per trace event
// (toActivityItem), live from the trace stream. `children` is the column's primary action; the
// footer opens the technical trace drawer. Used as the pinned column of the plan page.
// LiveStatusPill shows a course status that follows the same live state.

import { Check, Logs, RotateCcw, TriangleAlert, X } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect } from "react";
import type { ActivityItem, ActivityTone } from "./activity.ts";
import styles from "./activity-feed.module.css";
import { arabicTime, countOf, UPDATES } from "./format.ts";
import { useTrace } from "./trace-provider.tsx";
import { BidiText, cx, type Status, StatusPill } from "./ui.tsx";
import { useStickToBottom } from "./use-stick-to-bottom.ts";

const NOW_NOTE: Record<ActivityTone, string> = {
  working: "يعمل الآن",
  retrying: "يعيد المحاولة",
  warning: "يعمل الآن",
  done: "اكتمل",
  failed: "تعذّر",
};
const TONE_SR: Record<ActivityTone, string> = {
  working: "قيد العمل",
  retrying: "يعيد المحاولة",
  warning: "تنبيه",
  done: "اكتملت الخطوة",
  failed: "تعذّرت الخطوة",
};

function Dot({ tone }: { tone: ActivityTone }) {
  if (tone === "done") return <Check aria-hidden />;
  if (tone === "failed") return <X aria-hidden />;
  if (tone === "retrying") return <RotateCcw aria-hidden />;
  if (tone === "warning") return <TriangleAlert aria-hidden />;
  return null;
}

// `arrive` animates a line that came in while the page was open, not the replayed history.
function FeedItem({
  item,
  current,
  arrive,
}: {
  item: ActivityItem;
  current: boolean;
  arrive: boolean;
}) {
  return (
    <li
      className={cx(
        styles.item,
        styles[`tone_${item.tone}`],
        current && styles.current,
        arrive && styles.arrive,
      )}
      aria-current={current ? "step" : undefined}
    >
      <span className={styles.dot} aria-hidden>
        <Dot tone={item.tone} />
      </span>
      <div className={styles.body}>
        <p className={styles.itemHead}>
          <b>{item.agentName}</b>
          <span className={styles.end}>{current ? NOW_NOTE[item.tone] : arabicTime(item.at)}</span>
        </p>
        <p className={styles.text}>
          <BidiText text={item.text} />
        </p>
        <span className="sr-only">{TONE_SR[item.tone]}</span>
      </div>
    </li>
  );
}

// One sentence on what is happening, announced politely to screen readers.
function LiveLine({ last, running }: { last: ActivityItem | undefined; running: boolean }) {
  let tone = "idle";
  let content: ReactNode = "لا يعمل أي وكيل الآن.";
  if (last && running) {
    tone = last.tone === "working" ? "active" : "retrying";
    content = (
      <>
        <b>{last.agentName}</b> <BidiText text={last.text} />
      </>
    );
  } else if (last?.tone === "done") {
    tone = "done";
    content = "اكتمل آخر تشغيل، ولا يعمل أي وكيل الآن.";
  } else if (last?.tone === "failed") {
    tone = "failed";
    content = "توقّف آخر تشغيل عند خطوة تعذّر إكمالها.";
  }
  return (
    <div className={cx(styles.live, styles[`live_${tone}`])}>
      <span className={styles.liveDot} aria-hidden />
      <p className={styles.liveText} aria-live="polite" aria-atomic="true">
        {content}
      </p>
    </div>
  );
}

// A course status that turns to «قيد التحديث» while agents are working, and otherwise shows the
// status the page passes in.
export function LiveStatusPill({ status, label }: { status: Status; label: string }) {
  const { running } = useTrace();
  return running ? (
    <StatusPill status="building">قيد التحديث</StatusPill>
  ) : (
    <StatusPill status={status}>{label}</StatusPill>
  );
}

// Hides the older line cut by the list's top edge, so under the live line the list shows whole
// lines only: --cut is the height above the first line that starts inside the list.
function useWholeLines(ref: RefObject<HTMLOListElement | null>, count: number) {
  const hideCutLine = useCallback(() => {
    const list = ref.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    let cut = 0;
    for (const line of list.children) {
      const offset = line.getBoundingClientRect().top - top;
      if (offset >= -0.5) {
        cut = Math.max(0, offset);
        break;
      }
    }
    list.style.setProperty("--cut", `${cut}px`);
  }, [ref]);

  // After useStickToBottom has scrolled to a new line.
  useLayoutEffect(() => {
    if (count > 0) hideCutLine();
  }, [count, hideCutLine]);

  const hasList = count > 0;
  useEffect(() => {
    const list = ref.current;
    if (!hasList || !list) return;
    const observer = new ResizeObserver(hideCutLine);
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasList, ref, hideCutLine]);

  return hideCutLine;
}

export function ActivityFeed({ children }: { children?: ReactNode }) {
  const { activity, running, replayed, openDrawer } = useTrace();
  const list = useStickToBottom<HTMLOListElement>(activity.length);
  const hideCutLine = useWholeLines(list.ref, activity.length);
  const lastIndex = activity.length - 1;

  return (
    <aside className={styles.feed} aria-labelledby="activity-title">
      <div className={styles.inner}>
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <h2 id="activity-title">ما يحدث الآن</h2>
            {activity.length > 0 && <span>{countOf(activity.length, UPDATES)}</span>}
          </div>
          <LiveLine last={activity[lastIndex]} running={running} />
        </div>

        {activity.length === 0 ? (
          <p className={styles.empty}>
            حين يبدأ الوكلاء العمل على دورتك، تظهر خطواتهم هنا بلغة بسيطة، ومعها كل إعادة محاولة.
          </p>
        ) : (
          <ol
            ref={list.ref}
            onScroll={() => {
              list.onScroll();
              hideCutLine();
            }}
            className={styles.list}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be keyboard-scrollable
            tabIndex={0}
            aria-label="خطوات الوكلاء، الأقدم أولًا"
          >
            {activity.map((item, i) => (
              <FeedItem
                key={item.id}
                item={item}
                current={running && i === lastIndex}
                arrive={replayed !== null && !replayed.has(item.id)}
              />
            ))}
          </ol>
        )}

        {children && <div className={styles.cta}>{children}</div>}

        <div className={styles.foot}>
          <button type="button" className={styles.traceLink} onClick={openDrawer}>
            <Logs aria-hidden />
            <span>النماذج والتكلفة لكل خطوة في سجل الوكلاء</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
