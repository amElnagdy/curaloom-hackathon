"use client";

// The technical trace (#15, #59, #60): a tab on the inline end (the left edge in Arabic) with a live
// event count opens a drawer over that side, above a scrim that keeps the page out of reach until
// it closes. One row per trace event: the agent, the kind and the simulated time in Arabic, the
// Arabic summary, then a technical line in English (ids and the English summary), and the role,
// model, latency, cost and running total. Filters narrow the list by agent and kind. Esc or the
// scrim closes it, and focus returns to what opened it.

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
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { ProviderProfile } from "../../config.ts";
import { parseSimTime } from "../../server/clock/time.ts";
import type { TraceKind } from "../../server/trace/trace.ts";
import { agentName } from "./agents.ts";
import {
  arabicDigits,
  arabicNumber,
  arabicTime,
  countOf,
  EVENTS,
  latency,
  TIMES,
  techTime,
  usd,
} from "./format.ts";
import styles from "./trace-drawer.module.css";
import { useTrace } from "./trace-provider.tsx";
import {
  KIND_AR,
  NO_FILTER,
  roleName,
  shownText,
  TRACE_KINDS,
  type TraceFilter,
  type TraceRow,
  traceAgents,
  traceRows,
} from "./trace-view.ts";
import { BidiText, buttonClass, cx, DirIcon, MODE, SimTimeText } from "./ui.tsx";
import { useStickToBottom } from "./use-stick-to-bottom.ts";

const KIND_ICON: Record<TraceKind, LucideIcon> = {
  model_call: Cpu,
  tool_call: Wrench,
  decision: GitBranch,
  output: FileCheck,
  error: TriangleAlert,
};

// Arabic lines take Arabic-Indic digits; the technical line and the meta values keep Western
// tabular ones (DESIGN.md, «The Two Digit Systems Rule»).
function TraceEventRow({ row: { event, repeats } }: { row: TraceRow }) {
  const Icon = KIND_ICON[event.kind];
  const meta: [string, ReactNode][] = [];
  if (event.model) {
    meta.push([
      "النموذج",
      <bdi key="model" className={styles.techValue} dir="ltr" lang="en">
        {event.model}
      </bdi>,
    ]);
  }
  if (event.role) meta.push(["الدور", roleName(event.role)]);
  const tech = (value: string) => (
    <bdi className={styles.techValue} dir="ltr" lang="en">
      {value}
    </bdi>
  );
  if (event.latency_ms !== undefined) meta.push(["الزمن", tech(latency(event.latency_ms))]);
  if (event.cost_usd !== undefined) meta.push(["التكلفة", tech(usd(event.cost_usd))]);
  if (event.total_cost_usd !== undefined) meta.push(["الإجمالي", tech(usd(event.total_cost_usd))]);

  return (
    <li className={cx(styles.ev, event.kind === "error" && styles.evError)}>
      <span className={styles.evIcon}>
        <Icon aria-hidden />
      </span>
      <div className={styles.evBody}>
        <div className={styles.evHead}>
          <span className={styles.evAgent}>{agentName(event.agent)}</span>
          <span className={styles.evKind}>{KIND_AR[event.kind]}</span>
          {repeats > 1 && <span className={styles.evRepeat}>تكرر {countOf(repeats, TIMES)}</span>}
          <span className={styles.evWhen}>
            {event.sim_ts ? <SimTimeText now={parseSimTime(event.sim_ts)} /> : arabicTime(event.ts)}
          </span>
        </div>
        <p className={styles.evAr}>
          <BidiText text={arabicDigits(event.summary_ar)} />
        </p>
        <div className={styles.evTech} dir="ltr" lang="en">
          <p className={styles.evIds}>
            <span>{event.id}</span>
            <span>{event.agent}</span>
            <span>{event.kind}</span>
            {event.role && <span>{event.role}</span>}
            <span>{techTime(event.ts)}</span>
          </p>
          <p className={styles.evEn}>{event.summary_en}</p>
        </div>
        {meta.length > 0 && (
          <dl className={styles.evMeta}>
            {meta.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
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

function TraceFilters({
  agents,
  filter,
  onChange,
  agentRef,
}: {
  agents: string[];
  filter: TraceFilter;
  onChange(filter: TraceFilter): void;
  agentRef: RefObject<HTMLSelectElement | null>;
}) {
  return (
    // The first option of each list names it («كل الوكلاء»), so the lists carry no visible label and
    // the row fits the drawer at 150% zoom.
    <div className={styles.filters}>
      <select
        ref={agentRef}
        className={styles.filter}
        aria-label="الوكيل"
        value={filter.agent ?? ""}
        onChange={(e) => onChange({ ...filter, agent: e.target.value || null })}
      >
        <option value="">كل الوكلاء</option>
        {agents.map((agent) => (
          <option key={agent} value={agent}>
            {agentName(agent)}
          </option>
        ))}
      </select>
      <select
        className={styles.filter}
        aria-label="نوع الحدث"
        value={filter.kind ?? ""}
        onChange={(e) =>
          onChange({
            ...filter,
            kind: TRACE_KINDS.find((kind) => kind === e.target.value) ?? null,
          })
        }
      >
        <option value="">كل الأنواع</option>
        {TRACE_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_AR[kind]}
          </option>
        ))}
      </select>
      <label className={styles.fold}>
        <input
          type="checkbox"
          checked={filter.foldRepeats}
          onChange={(e) => onChange({ ...filter, foldRepeats: e.target.checked })}
        />
        دمج المتكرر
      </label>
    </div>
  );
}

// The page under the open drawer: dimmed by the scrim and inert, so neither a click nor Tab reaches
// it until the drawer closes.
export function BehindTrace({ className, children }: { className?: string; children: ReactNode }) {
  const { drawerOpen } = useTrace();
  return (
    <div className={className} inert={drawerOpen}>
      {children}
    </div>
  );
}

export function TraceDrawer({
  providerProfile,
  devTools,
}: {
  providerProfile: ProviderProfile;
  devTools: boolean;
}) {
  const trace = useTrace();
  const { events, drawerOpen, openDrawer, closeDrawer, drawerOpener } = trace;
  const [filter, setFilter] = useState<TraceFilter>(NO_FILTER);
  const rows = traceRows(events, filter);
  const tabRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const agentRef = useRef<HTMLSelectElement>(null);
  const wasOpen = useRef(false);
  const list = useStickToBottom<HTMLOListElement>(rows.length);
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
      // An open glossary card takes the Escape first (lesson/terms.tsx).
      if (e.key === "Escape" && !e.defaultPrevented) closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  const count = events.length;
  const sessionCount = count === 0 ? "لا أحداث بعد" : `${countOf(count, EVENTS)} في الجلسة`;
  const tabLabel = drawerOpen ? "أغلق سجل الوكلاء" : `افتح سجل الوكلاء، ${sessionCount}`;
  // The reset button goes with the empty state, so focus moves to the first filter.
  const showAll = () => {
    setFilter(NO_FILTER);
    agentRef.current?.focus();
  };

  return (
    <>
      {/* Pointer only: Esc and the close button are the keyboard's way out. */}
      <div
        className={cx(styles.scrim, drawerOpen && styles.scrimOn)}
        onClick={closeDrawer}
        aria-hidden
      />
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
        <Logs aria-hidden className={styles.tabIcon} />
        <span className={styles.tabLabel} aria-hidden>
          <span>سجل</span>
          <span>الوكلاء</span>
        </span>
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
              كل استدعاء نموذج أو أداة، وكل قرار، مع النموذج والتكلفة والزمن. وتحت كل حدث سطره
              التقني بالإنجليزية.
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
            <dt>أحداث الجلسة</dt>
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
            <dd>{MODE[providerProfile].label}</dd>
          </div>
        </dl>

        {trace.connection === "reconnecting" && (
          <p className={styles.connection} role="status">
            انقطع الاتصال بالسجل، ويُعاد الآن.
          </p>
        )}

        {count > 0 && (
          <TraceFilters
            agents={traceAgents(events)}
            filter={filter}
            onChange={setFilter}
            agentRef={agentRef}
          />
        )}
        <p className={styles.shown} role="status">
          {shownText(rows, count, filter)}
        </p>

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
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <p>لا أحداث تطابق هذا الاختيار.</p>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={showAll}>
              اعرض كل الأحداث
            </button>
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
            {rows.map((row) => (
              <TraceEventRow key={row.event.id} row={row} />
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
