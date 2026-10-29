"use client";

// The simulated clock for client controls (#23): the live time from the trace stream, and moves
// through POST /api/sessions/:id/sim/*. Right after a move the time is the route's answer until
// the stream's next clock event catches up. Used by Settings and the demo bar.

import { useEffect, useState } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import { formatSimTime, parseSimTime, type SimTime } from "../../server/clock/time.ts";
import { useTrace } from "./trace-provider.tsx";

export type SimMove =
  | { action: "advance"; body: { days?: number; minutes?: number } }
  | { action: "set"; body: { day: number } }
  | { action: "reset" };

export type MoveOutcome =
  | { kind: "moved"; events: CoachEvent[] }
  | { kind: "past" } // 409: the clock never goes back
  | { kind: "failed" };

export function useSimClock(sessionId: string) {
  const { simNow } = useTrace();
  const [answered, setAnswered] = useState<SimTime | null>(null);
  const [busy, setBusy] = useState(false);

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

  return { now: answered ?? simNow, busy, move };
}
