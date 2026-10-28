"use client";

// Calm disclosure rows (#15): a heading button that folds its body, inside a group that can fold
// or unfold all of them. Used for the plan's course outline (one row per module).

import { ChevronDown, ChevronUp } from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import styles from "./disclosure.module.css";
import { buttonClass, cx } from "./ui.tsx";

type Group = {
  ids: readonly string[];
  isOpen(id: string): boolean;
  toggle(id: string): void;
  setAll(open: boolean): void;
};

const GroupContext = createContext<Group | null>(null);

function useGroup(): Group {
  const group = useContext(GroupContext);
  if (!group) throw new Error("DisclosureRow must be used inside <DisclosureGroup>");
  return group;
}

// `ids` are the rows in the group, all open at first.
export function DisclosureGroup({
  ids,
  children,
}: {
  ids: readonly string[];
  children: ReactNode;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const group = useMemo<Group>(
    () => ({
      ids,
      isOpen: (id) => !folded.has(id),
      toggle: (id) =>
        setFolded((prev) => {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
      setAll: (open) => setFolded(open ? new Set() : new Set(ids)),
    }),
    [ids, folded],
  );
  return <GroupContext value={group}>{children}</GroupContext>;
}

// Folds every row while any is open, otherwise unfolds them all.
export function FoldAllButton() {
  const group = useGroup();
  const anyOpen = group.ids.some(group.isOpen);
  return (
    <button
      type="button"
      className={buttonClass("ghost", "sm")}
      aria-controls={group.ids.map((id) => `${id}-body`).join(" ")}
      onClick={() => group.setAll(!anyOpen)}
    >
      {anyOpen ? "طيّ الكل" : "توسيع الكل"}
      {anyOpen ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
    </button>
  );
}

// One row: the title folds the body; `meta` and `status` sit on the same line.
export function DisclosureRow({
  id,
  title,
  meta,
  status,
  children,
}: {
  id: string;
  title: string;
  meta?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  const group = useGroup();
  const open = group.isOpen(id);
  return (
    <section className={cx(styles.row, !open && styles.folded)} aria-labelledby={`${id}-title`}>
      <div className={styles.head}>
        <h3 className={styles.heading}>
          <button
            type="button"
            id={`${id}-title`}
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => group.toggle(id)}
          >
            <span className={styles.chevron} aria-hidden>
              <ChevronDown />
            </span>
            <span>{title}</span>
          </button>
        </h3>
        {meta && <span className={styles.meta}>{meta}</span>}
        {status && <span className={styles.status}>{status}</span>}
      </div>
      <div className={styles.body} id={`${id}-body`}>
        <div className={styles.inner}>{children}</div>
      </div>
    </section>
  );
}
