"use client";

// Renders the progress page again when what it reads may have changed: an agent step saved its
// output (a quiz graded, a plan version saved, a lesson written) or the clock moved. The same
// pattern as the coach page's RefreshOnCoachEvents, on other events.

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTrace } from "../_shell/trace-provider.tsx";

export function RefreshOnProgress() {
  const router = useRouter();
  const { events, replayed } = useTrace();
  const latest = replayed
    ? events.findLast((e) => (e.kind === "output" || e.agent === "clock") && !replayed.has(e.id))
        ?.id
    : undefined;
  useEffect(() => {
    if (latest) router.refresh();
  }, [latest, router]);
  return null;
}
