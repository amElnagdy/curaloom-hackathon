// Shared UI pieces for every route (#15). Plain components without state, so server and client
// components can both use them. Learner-facing text is Arabic; numbers come preformatted.

import {
  Check,
  Clock,
  FlaskConical,
  type LucideIcon,
  type LucideProps,
  Pause,
  X,
} from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { Resource } from "../../../contracts/index.ts";
import { hhmm, type SimTime } from "../../server/clock/time.ts";
import { simDay } from "./course.ts";
import { clockTime, splitRuns } from "./format.ts";
import styles from "./ui.module.css";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

// A drawn hairline between metadata parts. A middle dot beside Arabic-Indic digits reads as a zero
// («١ · ٤٥» looks like «١٠٤٥»), so learner-facing metadata never uses one. Screen readers hear a comma.
export function Sep() {
  return (
    <span className={styles.sep}>
      <span className="sr-only">، </span>
    </span>
  );
}

// Metadata parts joined by hairlines, e.g. «اليوم ١ | ٤٥ دقيقة».
export function Meta({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 && <Sep />}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

// Arabic text with embedded Latin, Cyrillic or CJK runs. Each foreign run is isolated in <bdi>, so
// the punctuation and numbers around it stay in place.
export function BidiText({ text }: { text: string }) {
  return (
    <>
      {splitRuns(text).map((run) =>
        run.foreign ? (
          <bdi key={run.start} lang={run.lang}>
            {run.text}
          </bdi>
        ) : (
          <Fragment key={run.start}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}

// A directional icon (chevron, arrow, drawer handle), named by its LTR meaning and mirrored in RTL.
// Non-directional icons are used as they are.
export function DirIcon({ icon: Icon, className, ...props }: { icon: LucideIcon } & LucideProps) {
  return <Icon aria-hidden className={cx(styles.mirror, className)} {...props} />;
}

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

// Class names for a button-styled <button> or <Link>. `iconOnly` makes it square.
export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize = "md",
  { iconOnly = false, className }: { iconOnly?: boolean; className?: string } = {},
): string {
  return cx(
    styles.btn,
    styles[variant],
    size !== "md" && styles[size],
    iconOnly && styles.iconOnly,
    className,
  );
}

// Status carries meaning only: ready green, building blue, waiting grey, attention amber,
// failed red; neutral for states that are none of these (cancelled, stopped).
export type Status = "ready" | "building" | "waiting" | "attention" | "failed" | "neutral";

// `quiet` drops the fill (dot and coloured word), for rows inside a list.
export function StatusPill({
  status,
  children,
  quiet = false,
}: {
  status: Status;
  children: ReactNode;
  quiet?: boolean;
}) {
  return (
    <span className={cx(styles.pill, styles[`pill_${status}`], quiet && styles.pillQuiet)}>
      <span className={styles.pillDot} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

export type Lang = Resource["lang"] | "ar";

// The Arabic name of each language, for labels and screen readers.
export const LANG_NAMES: Record<Lang, string> = {
  ar: "العربية",
  en: "الإنجليزية",
  ru: "الروسية",
  zh: "الصينية",
  fr: "الفرنسية",
};

// A source language: the ISO code for the eye, the Arabic name for screen readers. `full` also
// shows the Arabic name.
export function LangBadge({ lang, full = false }: { lang: Lang; full?: boolean }) {
  const code = lang.toUpperCase();
  if (full) {
    return (
      <span className={cx(styles.lang, styles.langFull)}>
        <b lang="en">{code}</b>
        <span>{LANG_NAMES[lang]}</span>
      </span>
    );
  }
  return (
    <span className={styles.lang} title={LANG_NAMES[lang]}>
      <span aria-hidden lang="en">
        {code}
      </span>
      <span className="sr-only">{LANG_NAMES[lang]}</span>
    </span>
  );
}

// An SPDX licence id and whether code verified it. `verified: false` is shown as rejected: a
// model's claim is not evidence (PRODUCT.md, ADR-006).
export function LicenceTag({ spdx, verified }: { spdx: string; verified: boolean }) {
  const label = verified ? "تحقّق الكود من الترخيص" : "لم يثبت الكود هذا الترخيص";
  return (
    <span
      className={cx(styles.licence, verified ? styles.licenceVerified : styles.licenceRejected)}
      title={label}
    >
      {verified ? <Check aria-hidden /> : <X aria-hidden />}
      <span lang="en" dir="ltr">
        {verified ? spdx : <s>{spdx}</s>}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const REJECTED_NOTE = "رُفض: لم يثبت الكود ترخيصه";

// One source: language badge, original title (isolated, in its own script), an Arabic note, and
// the licence. A rejected source is struck through and says why. Put it inside an <li>.
export function SourceRow({ resource, note }: { resource: Resource; note?: string }) {
  const { verified, spdx } = resource.licence;
  return (
    <div className={cx(styles.source, !verified && styles.sourceRejected)}>
      <LangBadge lang={resource.lang} />
      <span className={styles.sourceText}>
        <span className={styles.sourceTitle} dir="auto" lang={resource.lang}>
          {resource.title}
        </span>
        <span className={styles.sourceMeta}>
          <BidiText text={verified ? (note ?? resource.why_ar) : REJECTED_NOTE} />
        </span>
      </span>
      <LicenceTag spdx={spdx} verified={verified} />
    </div>
  );
}

// One outline row: icon, title (a link when `href` is set) and meta on one line, and a trailing
// status. `muted` is for a placeholder row ("not written yet"). Put it inside an <li>.
export function ItemRow({
  icon: Icon,
  title,
  href,
  meta,
  trail,
  muted = false,
}: {
  icon: LucideIcon;
  title: ReactNode;
  href?: string;
  meta?: ReactNode;
  trail?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={cx(styles.item, muted && styles.itemMuted)}>
      <span className={styles.itemIcon}>
        <Icon aria-hidden />
      </span>
      <span className={styles.itemText}>
        {/* The title clips itself, so a link's focus ring is drawn outside it, not cut off. */}
        {href ? (
          <Link href={href} className={styles.itemTitle}>
            {title}
          </Link>
        ) : (
          <span className={styles.itemTitle}>{title}</span>
        )}
        {meta && <span className={styles.itemMeta}>{meta}</span>}
      </span>
      {trail}
    </div>
  );
}

// A labelled group of rows inside an outline section: «الدروس», «الجلسات», «المصادر».
export function RowGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <h4 className={styles.groupLabel}>{label}</h4>
      <ul className={styles.rows}>{children}</ul>
    </div>
  );
}

// Marks the shown learner and content as sample data.
export function SampleBadge() {
  return (
    <span className={styles.sample} title="المتعلم والمحتوى للعرض فقط، ولم يُحدَّد موضوع الدورة بعد">
      <FlaskConical aria-hidden />
      <span className={styles.sampleLabel}>بيانات تجريبية</span>
    </span>
  );
}

// The simulated clock (ADR-004), display only: the day by name and the Arabic time of day. `now` is
// null while the page has not read the clock yet; then only the icon shows.
export function SimClockPill({ now, running }: { now: SimTime | null; running: boolean }) {
  const dayText = now ? simDay(now.day) : null;
  const timeText = now ? clockTime(hhmm(now.minute)) : null;
  const state = running ? "" : "، متوقفة";
  return (
    <span
      className={cx(styles.clock, !running && styles.clockPaused)}
      role="timer"
      aria-label={`ساعة المحاكاة${now ? `: ${dayText}، ${timeText}${state}` : ""}`}
      title="ساعة المحاكاة"
    >
      {running ? <Clock aria-hidden /> : <Pause aria-hidden />}
      {now && (
        <>
          <span aria-hidden>{dayText}</span>
          <span className={styles.clockSep} aria-hidden />
          <span className={styles.clockTime} aria-hidden>
            {timeText}
          </span>
        </>
      )}
    </span>
  );
}
