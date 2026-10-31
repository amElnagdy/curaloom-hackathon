"use client";

// The slim icon rail on the right (RTL start) (#15). It expands to labels with the toggle; while
// slim, each label shows as a tooltip and stays the link's accessible name. The account group
// (consent, settings) sits apart. The open/closed choice is remembered per browser.
// At phone width (#35) the rail leaves the side: a menu button in the top bar opens it as a sheet,
// which a link, Escape or a tap outside closes. The sheet is never remembered.

import { Menu, PanelLeft, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type AppRoute, ROUTES, routeForPath } from "../routes.ts";
import styles from "./shell.module.css";
import { useTrace } from "./trace-provider.tsx";
import { DirIcon } from "./ui.tsx";

const STORAGE_KEY = "rail";
const WIDE = "(min-width: 761px)";

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

function storeOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

// Three warp threads and two weft threads: a placeholder mark until a name and logo are chosen.
function BrandMark() {
  return (
    <span className={styles.brandMark}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        aria-hidden
        focusable="false"
      >
        <path d="M6 4v16M12 4v16M18 4v16M3 9h18M3 15h18" />
      </svg>
    </span>
  );
}

function NavItem({
  route,
  current,
  busy,
  onClick,
}: {
  route: AppRoute;
  current: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const Icon = route.icon;
  return (
    <li>
      <Link
        href={route.path}
        className={styles.navLink}
        aria-current={current ? "page" : undefined}
        data-busy={busy || undefined}
        onClick={onClick}
      >
        <Icon aria-hidden />
        <span className={styles.navLabel}>{route.label}</span>
        {busy && <span className="sr-only">، يعمل الوكلاء الآن</span>}
      </Link>
    </li>
  );
}

export function Rail({ appName, learnerName }: { appName: string; learnerName: string }) {
  const pathname = usePathname();
  const { running } = useTrace();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const currentId = routeForPath(pathname)?.id;

  useLayoutEffect(() => setOpen(readStoredOpen()), []);
  useLayoutEffect(() => {
    document.documentElement.dataset.rail = open ? "open" : "closed";
  }, [open]);

  useEffect(() => {
    if (!sheet) return;
    const close = () => setSheet(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      close();
      menuRef.current?.focus();
    };
    // On pointerup, as the glossary cards do (lesson/terms.tsx): a scroll ends in pointercancel.
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!railRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    // Past phone width the rail is a column again, and an open sheet would widen its labels.
    const wide = matchMedia(WIDE);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerup", onPointer);
    wide.addEventListener("change", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerup", onPointer);
      wide.removeEventListener("change", close);
    };
  }, [sheet]);

  const toggle = () => {
    setOpen(!open);
    storeOpen(!open);
  };
  const toggleLabel = open ? "اطوِ القائمة" : "وسّع القائمة";
  const closeSheet = () => setSheet(false);
  const item = (route: AppRoute) => (
    <NavItem
      key={route.id}
      route={route}
      current={route.id === currentId}
      busy={running && route.id === "plan"}
      onClick={closeSheet}
    />
  );

  return (
    <>
      <button
        ref={menuRef}
        type="button"
        className={styles.menu}
        aria-expanded={sheet}
        aria-controls="app-rail"
        aria-label={sheet ? "أغلق القائمة" : "افتح القائمة"}
        onClick={() => setSheet(!sheet)}
      >
        {sheet ? <X aria-hidden /> : <Menu aria-hidden />}
      </button>
      <div
        ref={railRef}
        className={styles.rail}
        id="app-rail"
        data-open={open || sheet}
        data-sheet={sheet ? "open" : undefined}
      >
        <div className={styles.brand}>
          <Link href="/plan" className={styles.brandLink} onClick={closeSheet}>
            <BrandMark />
            <span className={styles.brandText}>
              <bdi className={styles.brandName}>{appName}</bdi>
              <span className={styles.brandNote}>اسم مؤقت</span>
            </span>
          </Link>
        </div>

        <nav className={styles.nav} aria-label="التنقل الرئيسي">
          <ul>{ROUTES.filter((r) => r.group === "learn").map(item)}</ul>
          <ul className={styles.navAccount} aria-label="حسابك">
            {ROUTES.filter((r) => r.group === "account").map(item)}
          </ul>
        </nav>

        <div className={styles.railFoot}>
          <button
            type="button"
            className={styles.railToggle}
            aria-expanded={open}
            aria-controls="app-rail"
            aria-label={toggleLabel}
            onClick={toggle}
          >
            <DirIcon icon={PanelLeft} />
            <span className={styles.tip} aria-hidden>
              {toggleLabel}
            </span>
          </button>
          <div className={styles.me}>
            <span className={styles.avatar} aria-hidden>
              {learnerName.charAt(0)}
            </span>
            <span className={styles.meName}>{learnerName}</span>
          </div>
        </div>
      </div>
    </>
  );
}
