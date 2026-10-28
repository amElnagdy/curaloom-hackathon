"use client";

// The slim top bar (#15): breadcrumb for the current route, then the sample-data badge and the
// simulated clock passed in by the server shell.

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { routeForPath } from "../routes.ts";
import styles from "./shell.module.css";
import { DirIcon, SampleBadge } from "./ui.tsx";

export function TopBar({ clock }: { clock: ReactNode }) {
  const route = routeForPath(usePathname());
  return (
    <header className={styles.top}>
      <nav className={styles.crumb} aria-label="مسار التنقل">
        <ol>
          <li>دورتي</li>
          {route && (
            <li>
              <DirIcon icon={ChevronRight} />
              <span aria-current="page">{route.label}</span>
            </li>
          )}
        </ol>
      </nav>
      <span className={styles.spacer} />
      <SampleBadge />
      {clock}
    </header>
  );
}
