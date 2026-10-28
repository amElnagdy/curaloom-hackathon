"use client";

// Keeps a scrolling list on its newest (last) item while the reader is at the bottom. When new
// items arrive while they have scrolled up, `behind` turns true so the UI can offer a jump.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

const PINNED_SLACK_PX = 32;

export function useStickToBottom<T extends HTMLElement>(itemCount: number) {
  const ref = useRef<T>(null);
  const pinned = useRef(true);
  const [behind, setBehind] = useState(false);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_SLACK_PX;
    if (pinned.current) setBehind(false);
  }, []);

  const jump = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinned.current = true;
    setBehind(false);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || itemCount === 0) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [itemCount]);

  return { ref, onScroll, behind, jump };
}
