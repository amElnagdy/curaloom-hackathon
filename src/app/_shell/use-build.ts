"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Posts {} to `url` until the server has built what it names (a plan, a lesson), then shows the page
// again, `done` with it. A null url builds nothing, and a url set again starts a new build, not done
// and not failed. After a failure it waits for retry().
export function useBuild(url: string | null): { failed: boolean; done: boolean; retry(): void } {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [building, setBuilding] = useState(url);
  const [, startTransition] = useTransition();

  if (url !== building) {
    setBuilding(url);
    if (url) {
      setDone(false);
      setFailed(false);
    }
  }

  useEffect(() => {
    if (!url || failed) return;
    const abort = new AbortController();
    (async () => {
      while (!abort.signal.aborted) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: abort.signal,
        }).catch(() => null);
        if (abort.signal.aborted) return;
        // While another request builds the same thing, the server answers 409 with Retry-After.
        const wait = res?.status === 409 && Number(res.headers.get("retry-after"));
        if (wait) {
          await new Promise((resolve) => setTimeout(resolve, wait * 1000));
          continue;
        }
        if (res?.ok) {
          startTransition(() => {
            setDone(true);
            router.refresh();
          });
        } else setFailed(true);
        return;
      }
    })();
    return () => abort.abort();
  }, [url, failed, router]);

  return { failed, done, retry: () => setFailed(false) };
}
