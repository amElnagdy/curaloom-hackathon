"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Failure = "failed" | "stuck";

// How a build that did not succeed failed: `stuck` when the server says a retry cannot pass, as the
// plan's build does for a missing recording (#58).
export async function failureOf(res: Response | null): Promise<Failure> {
  const body: { stuck?: unknown } | null | undefined = await res?.json().catch(() => null);
  return body?.stuck === true ? "stuck" : "failed";
}

// Posts {} to `url` until the server has built what it names (a plan, a lesson), then shows the page
// again, `done` with it. A null url builds nothing, and a url set again starts a new build, not done
// and not failed. After a failure it waits for retry().
export function useBuild(url: string | null): {
  failed: boolean;
  stuck: boolean;
  done: boolean;
  retry(): void;
} {
  const router = useRouter();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState(false);
  const [building, setBuilding] = useState(url);
  const [, startTransition] = useTransition();
  const failed = failure !== null;

  if (url !== building) {
    setBuilding(url);
    if (url) {
      setDone(false);
      setFailure(null);
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
          return;
        }
        const why = await failureOf(res);
        if (!abort.signal.aborted) setFailure(why);
        return;
      }
    })();
    return () => abort.abort();
  }, [url, failed, router]);

  return { failed, stuck: failure === "stuck", done, retry: () => setFailure(null) };
}
