"use client";

// The slim icon rail on the right (RTL start) (#15). It expands to labels with the toggle; while
// slim, each label shows as a tooltip and stays the link's accessible name. The account group
// (consent, settings) sits apart. The open/closed choice is remembered per browser.

import { PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { type AppRoute, ROUTES, routeForPath } from "../routes.ts";
import styles from "./shell.module.css";
import { useTrace } from "./trace-provider.tsx";
import { DirIcon } from "./ui.tsx";

const STORAGE_KEY = "rail";

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

function NavItem({ route, current, busy }: { route: AppRoute; current: boolean; busy: boolean }) {
  const Icon = route.icon;
  return (
    <li>
      <Link
        href={route.path}
        className={styles.navLink}
        aria-current={current ? "page" : undefined}
        data-busy={busy || undefined}
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
  const currentId = routeForPath(pathname)?.id;

  useLayoutEffect(() => setOpen(readStoredOpen()), []);
  useLayoutEffect(() => {
    document.documentElement.dataset.rail = open ? "open" : "closed";
  }, [open]);

  const toggle = () => {
    setOpen(!open);
    storeOpen(!open);
  };
  const toggleLabel = open ? "اطوِ القائمة" : "وسّع القائمة";
  const item = (route: AppRoute) => (
    <NavItem
      key={route.id}
      route={route}
      current={route.id === currentId}
      busy={running && route.id === "plan"}
    />
  );

  return (
    <div className={styles.rail} id="app-rail" data-open={open}>
      <div className={styles.brand}>
        <Link href="/plan" className={styles.brandLink}>
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
  );
}
