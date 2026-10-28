// The app shell (#15), layout C: icon rail on the right, top bar, the page in <main>, and the trace
// tab and drawer on the left edge. Rendered once by the root layout; pages render inside <main>,
// which has no padding of its own (pages use --page-gutter and --page-gutter-end from globals.css).

import type { ReactNode } from "react";
import { LiveSimClockPill } from "./activity-feed.tsx";
import { Rail } from "./rail.tsx";
import styles from "./shell.module.css";
import { TopBar } from "./top-bar.tsx";
import { TraceDrawer } from "./trace-drawer.tsx";

export function Shell({
  appName,
  learnerName,
  providerProfile,
  simClock,
  devTools,
  children,
}: {
  appName: string;
  learnerName: string;
  providerProfile: string;
  simClock: boolean;
  devTools: boolean;
  children: ReactNode;
}) {
  const clock = simClock ? <LiveSimClockPill /> : null;

  return (
    <>
      <a href="#main" className={styles.skip}>
        تخطَّ إلى المحتوى
      </a>
      <div className={styles.frame}>
        <Rail appName={appName} learnerName={learnerName} />
        <div className={styles.column}>
          <TopBar clock={clock} />
          <main id="main" tabIndex={-1} className={styles.main}>
            {children}
          </main>
        </div>
      </div>
      <TraceDrawer providerProfile={providerProfile} devTools={devTools} />
    </>
  );
}
