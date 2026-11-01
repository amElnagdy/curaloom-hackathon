"use client";

// The simulated clock for client controls (#23): the live time from the trace stream, and moves
// through POST /api/sessions/:id/sim/*. Right after a move the time is the route's answer until
// the stream's next clock event catches up. Used by Settings and the demo bar.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import { formatSimTime, parseSimTime, type SimTime } from "../../server/clock/time.ts";
import type { PlanKind } from "./lessons.ts";
import { useTrace } from "./trace-provider.tsx";

export type SimMove =
  | { action: "advance"; body: { days?: number; minutes?: number } }
  | { action: "set"; body: { day: number } }
  | { action: "reset" };

export type MoveOutcome =
  | { kind: "moved"; events: CoachEvent[] }
  | { kind: "past" } // 409: the clock never goes back
  | { kind: "failed" };

// Why the controls that move the clock forward are off while `waitsForPlan`.
export const WAITS_FOR_PLAN = "تتحرك الساعة بعد أن تجهز خطتك";

// A step traces its output just before it saves it, so the plan is read once the trace is quiet.
const QUIET_MS = 400;

// Whether the clock waits for the learner's plan (#61), from GET /api/sessions/:id/plan. Between the
// intake and the plan the coach has no study of theirs to follow, so a move would fire its messages
// about a plan that does not exist. The seed's sample and a built plan move freely, and a read that
// fails never holds the clock.
export async function readWaitsForPlan(sessionId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/plan`, { signal });
    if (!res.ok) return false;
    const { kind } = (await res.json()) as { kind: PlanKind };
    return kind === "none";
  } catch {
    return false;
  }
}

// The plan is read on each page and after new trace events.
function useWaitsForPlan(sessionId: string): boolean {
  const pathname = usePathname();
  const traced = useTrace().events.length;
  const [waits, setWaits] = useState(false);

  // A read cut short by the next one says nothing.
  const read = useCallback(
    async (signal: AbortSignal) => {
      const answer = await readWaitsForPlan(sessionId, signal);
      if (!signal.aborted) setWaits(answer);
    },
    [sessionId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: each page reads the plan anew
  useEffect(() => {
    const controller = new AbortController();
    read(controller.signal);
    return () => controller.abort();
  }, [read, pathname]);

  useEffect(() => {
    if (traced === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => read(controller.signal), QUIET_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [read, traced]);

  return waits;
}

export function useSimClock(sessionId: string) {
  const { simNow } = useTrace();
  const [answered, setAnswered] = useState<SimTime | null>(null);
  const [busy, setBusy] = useState(false);
  const waitsForPlan = useWaitsForPlan(sessionId);

  const streamed = simNow && formatSimTime(simNow);
  useEffect(() => {
    if (streamed) setAnswered(null);
  }, [streamed]);

  async function move(m: SimMove): Promise<MoveOutcome> {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/sim/${m.action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("body" in m ? m.body : {}),
      });
      if (res.status === 409) return { kind: "past" };
      if (!res.ok) return { kind: "failed" };
      const result = (await res.json()) as { now: string; events: CoachEvent[] };
      setAnswered(parseSimTime(result.now));
      return { kind: "moved", events: result.events };
    } catch {
      return { kind: "failed" };
    } finally {
      setBusy(false);
    }
  }

  return { now: answered ?? simNow, busy, move, waitsForPlan };
}
