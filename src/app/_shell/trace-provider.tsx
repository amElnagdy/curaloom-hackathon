"use client";

// The live trace of one session (#15). Opens ONE EventSource to the trace stream for the whole app
// and serves the trace drawer, the activity feed and anything else that shows agent work. It also
// owns whether the drawer is open, so any button can open it.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SimTime } from "../../server/clock/time.ts";
import type { TraceEvent } from "../../server/trace/trace.ts";
import { type ActivityItem, clockNow, stepsRunning, toActivityItem } from "./activity.ts";

export type TraceConnection = "connecting" | "open" | "reconnecting";

type TraceState = {
  sessionId: string;
  events: TraceEvent[];
  // Learner-facing lines, oldest first.
  activity: ActivityItem[];
  // True while the newest activity line is a step still in progress.
  running: boolean;
  // Ids of the events the stream replayed on connecting (the session's history so far), once that
  // first flush has settled; null until then. Only events after it are new to this page.
  replayed: ReadonlySet<string> | null;
  totalCostUsd: number;
  // The simulated clock, from the clock's own events; null until the history has replayed.
  simNow: SimTime | null;
  connection: TraceConnection;
  drawerOpen: boolean;
  openDrawer(): void;
  closeDrawer(): void;
  // The element focus returns to when the drawer closes (whatever opened it), if any.
  drawerOpener: { current: HTMLElement | null };
};

const TraceContext = createContext<TraceState | null>(null);

// The stream sends the stored history in one burst on connecting, then polls every 500 ms
// (src/server/trace/http.ts). A pause this long after the burst means the history is all in.
const REPLAY_SETTLE_MS = 250;

export function useTrace(): TraceState {
  const state = useContext(TraceContext);
  if (!state) throw new Error("useTrace must be used inside <TraceProvider>");
  return state;
}

function parseEvent(data: string): TraceEvent | null {
  try {
    const event = JSON.parse(data) as TraceEvent;
    return typeof event?.id === "string" ? event : null;
  } catch {
    return null;
  }
}

export function TraceProvider({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [connection, setConnection] = useState<TraceConnection>("connecting");
  const [replayed, setReplayed] = useState<ReadonlySet<string> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // EventSource reconnects on its own and sends Last-Event-ID, so the stream resumes where it
    // stopped; the id check below drops any event that arrives twice.
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/trace/stream`);
    const history: string[] = [];
    let settle: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const waitForQuiet = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        settled = true;
        setReplayed(new Set(history));
      }, REPLAY_SETTLE_MS);
    };
    source.onopen = () => {
      setConnection("open");
      if (!settled) waitForQuiet();
    };
    source.onerror = () => setConnection("reconnecting");
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (!event) return;
      if (!settled) {
        history.push(event.id);
        waitForQuiet();
      }
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
    };
    return () => {
      clearTimeout(settle);
      source.close();
    };
  }, [sessionId]);

  const openDrawer = useCallback(() => {
    const active = document.activeElement;
    drawerOpener.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const value = useMemo<TraceState>(() => {
    const activity = events.map(toActivityItem).filter((item) => item !== null);
    return {
      sessionId,
      events,
      activity,
      running: stepsRunning(events),
      replayed,
      totalCostUsd: events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0),
      simNow: replayed === null ? null : clockNow(events),
      connection,
      drawerOpen,
      openDrawer,
      closeDrawer,
      drawerOpener,
    };
  }, [sessionId, events, replayed, connection, drawerOpen, openDrawer, closeDrawer]);

  return <TraceContext value={value}>{children}</TraceContext>;
}
