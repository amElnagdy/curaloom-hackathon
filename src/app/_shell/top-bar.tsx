"use client";

// The slim top bar (#15): breadcrumb for the current route, then the badge that says whether the
// models answer live or from recordings (#30), and the simulated clock passed in by the server shell.

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { ProviderProfile } from "../../config.ts";
import { routeForPath } from "../routes.ts";
import styles from "./shell.module.css";
import { DirIcon, ModeBadge } from "./ui.tsx";

export function TopBar({ clock, profile }: { clock: ReactNode; profile: ProviderProfile }) {
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
      <ModeBadge profile={profile} />
      {clock}
    </header>
  );
}
