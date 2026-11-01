// Says how the models answer on this server (#30): a viewer always knows whether a reply was written
// now or recorded earlier. The learner is a sample persona in every mode.
// A button with a native popover (#66), so a click, a tap, Enter or Space opens the explanation and
// Esc or a click outside closes it, with no hover.

import { type CSSProperties, useId } from "react";
import type { ProviderProfile } from "../../config.ts";
import styles from "./mode-badge.module.css";
import { cx, MODE } from "./ui.tsx";

export function ModeBadge({ profile }: { profile: ProviderProfile }) {
  const mode = MODE[profile];
  const id = useId();
  const tipId = `mode-tip${id}`;
  // The top bar and the demo bar each show a badge, so each pair needs its own anchor name.
  const anchor = { "--anchor": `--mode${id}` } as CSSProperties;
  return (
    <>
      <button
        type="button"
        className={cx(styles.mode, profile === "live" && styles.live)}
        style={anchor}
        popoverTarget={tipId}
        aria-describedby={tipId}
      >
        <mode.icon aria-hidden />
        <span className={styles.label}>{mode.label}</span>
        <bdi className={styles.code} dir="ltr" lang="en">
          {mode.code}
        </bdi>
      </button>
      <div id={tipId} popover="auto" className={styles.tip} style={anchor}>
        {mode.about.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        <p className={styles.persona}>المتعلم شخصية تجريبية.</p>
      </div>
    </>
  );
}
