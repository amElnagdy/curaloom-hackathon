"use client";

// The technical trace (#15): a tab on the left edge with a live event count opens a drawer that
// overlays the left side. One row per trace event: agent, Arabic and English summary, kind, model,
// latency, cost and the running total. Esc closes it and focus returns to what opened it.

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileCheck,
  GitBranch,
  Logs,
  type LucideIcon,
  Play,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TraceEvent, TraceKind } from "../../server/trace/trace.ts";
import { agentName } from "./agents.ts";
import { arabicNumber, countOf, EVENTS, latency, techTime, usd } from "./format.ts";
import styles from "./trace-drawer.module.css";
import { useTrace } from "./trace-provider.tsx";
import { BidiText, buttonClass, cx, DirIcon } from "./ui.tsx";
import { useStickToBottom } from "./use-stick-to-bottom.ts";

const KIND_ICON: Record<TraceKind, LucideIcon> = {
  model_call: Cpu,
  tool_call: Wrench,
  decision: GitBranch,
  output: FileCheck,
  error: TriangleAlert,
};
const KIND_AR: Record<TraceKind, string> = {
  model_call: "استدعاء نموذج",
  tool_call: "استدعاء أداة",
  decision: "قرار",
  output: "مخرج",
  error: "خطأ",
};

function TraceEventRow({ event }: { event: TraceEvent }) {
  const Icon = KIND_ICON[event.kind];
  const meta: [string, string][] = [];
  if (event.model) meta.push(["النموذج", event.model]);
  if (event.latency_ms !== undefined) meta.push(["الزمن", latency(event.latency_ms)]);
  if (event.cost_usd !== undefined) meta.push(["التكلفة", usd(event.cost_usd)]);
  if (event.total_cost_usd !== undefined) meta.push(["الإجمالي", usd(event.total_cost_usd)]);

  return (
    <li className={cx(styles.ev, event.kind === "error" && styles.evError)}>
      <div className={styles.evHead}>
        <span className={styles.evIcon}>
          <Icon aria-hidden />
        </span>
        <span className={styles.evAgent} title={event.agent}>
          {agentName(event.agent)}
        </span>
        <span className={styles.evKind} title={KIND_AR[event.kind]} lang="en">
          {event.kind}
        </span>
        <span className={styles.evId} dir="ltr" lang="en">
          {event.id}
          <span className={styles.evIdSep} aria-hidden />
          {techTime(event.ts)}
        </span>
      </div>
      <p className={styles.evAr}>
        <BidiText text={event.summary_ar} />
      </p>
      <p className={styles.evEn} dir="ltr" lang="en">
        {event.summary_en}
      </p>
      {meta.length > 0 && (
        <dl className={styles.evMeta}>
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd lang="en">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

type RunState = "idle" | "starting" | "busy" | "error";

// Dev only: starts the dummy agent (POST /api/dev/dummy-run), whose events then stream in.
function DummyRunButton({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<RunState>("idle");

  async function start() {
    setState("starting");
    try {
      const res = await fetch("/api/dev/dummy-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setState(res.ok ? "idle" : res.status === 409 ? "busy" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className={styles.run}>
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        onClick={start}
        disabled={state === "starting"}
      >
        <Play aria-hidden />
        تشغيل تجريبي
      </button>
      <p className={styles.runNote} role="status">
        {state === "busy" && "يعمل تشغيل تجريبي الآن."}
        {state === "error" && "تعذّر بدء التشغيل التجريبي."}
      </p>
    </div>
  );
}

export function TraceDrawer({
  providerProfile,
  devTools,
}: {
  providerProfile: string;
  devTools: boolean;
}) {
  const trace = useTrace();
  const { events, drawerOpen, openDrawer, closeDrawer, drawerOpener } = trace;
  const tabRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const list = useStickToBottom<HTMLOListElement>(events.length);
  const { jump } = list;

  // Opening moves focus into the drawer and shows the newest event; closing returns focus.
  useEffect(() => {
    if (drawerOpen && !wasOpen.current) {
      jump();
      closeRef.current?.focus();
    } else if (!drawerOpen && wasOpen.current) {
      (drawerOpener.current ?? tabRef.current)?.focus();
      drawerOpener.current = null;
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen, jump, drawerOpener]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  const count = events.length;
  const tabLabel = drawerOpen
    ? "أغلق سجل الوكلاء"
    : `افتح سجل الوكلاء، ${count === 0 ? "لا أحداث بعد" : countOf(count, EVENTS)}`;

  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={styles.tab}
        aria-expanded={drawerOpen}
        aria-controls="trace-drawer"
        aria-label={tabLabel}
        onClick={drawerOpen ? closeDrawer : openDrawer}
      >
        {/* LTR names: closed points toward the content (mirrored: right), open points back. */}
        <DirIcon icon={drawerOpen ? ChevronRight : ChevronLeft} className={styles.tabHandle} />
        <Logs aria-hidden />
        <span className={styles.tabLabel}>سجل الوكلاء</span>
        {/* An Arabic-Indic zero is a dot: with no events the badge would read as a status dot. */}
        {count > 0 && (
          <span key={count} className={styles.tabCount}>
            {arabicNumber(count)}
          </span>
        )}
      </button>

      <aside
        id="trace-drawer"
        className={cx(styles.drawer, drawerOpen && styles.open)}
        aria-labelledby="trace-title"
        inert={!drawerOpen}
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title} id="trace-title">
              سجل الوكلاء
            </h2>
            <p className={styles.sub}>
              كل استدعاء نموذج أو أداة، وكل قرار، مع النموذج والتكلفة والزمن.
            </p>
          </div>
          {devTools && <DummyRunButton sessionId={trace.sessionId} />}
          <button
            ref={closeRef}
            type="button"
            className={buttonClass("ghost", "sm", { iconOnly: true })}
            aria-label="أغلق سجل الوكلاء"
            onClick={closeDrawer}
          >
            <X aria-hidden />
          </button>
        </div>

        <dl className={styles.sum}>
          <div>
            <dt>الأحداث</dt>
            <dd>{arabicNumber(count)}</dd>
          </div>
          <div>
            <dt>التكلفة حتى الآن</dt>
            <dd className={styles.tech} lang="en">
              {usd(trace.totalCostUsd)}
            </dd>
          </div>
          <div>
            <dt>وضع النماذج</dt>
            <dd className={styles.tech} lang="en">
              {providerProfile}
            </dd>
          </div>
        </dl>

        {trace.connection === "reconnecting" && (
          <p className={styles.connection} role="status">
            انقطع الاتصال بالسجل، ويُعاد الآن.
          </p>
        )}

        {count === 0 ? (
          <div className={styles.empty}>
            <Logs aria-hidden />
            <p>لا أحداث بعد.</p>
            <p className={styles.emptyHint}>
              {devTools
                ? "اضغط «تشغيل تجريبي» لترى خطوات وكيل تجريبي هنا لحظة بلحظة."
                : "تظهر هنا كل خطوة يخطوها الوكلاء لحظة بلحظة."}
            </p>
          </div>
        ) : (
          <ol
            ref={list.ref}
            onScroll={list.onScroll}
            className={styles.list}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be keyboard-scrollable
            tabIndex={0}
            aria-label="الأحداث، الأقدم أولًا"
          >
            {events.map((event) => (
              <TraceEventRow key={event.id} event={event} />
            ))}
          </ol>
        )}

        {list.behind && (
          <button
            type="button"
            className={buttonClass("secondary", "sm", { className: styles.jump })}
            onClick={jump}
          >
            <ChevronDown aria-hidden />
            أحدث الأحداث
          </button>
        )}
      </aside>
    </>
  );
}
