// Building blocks for the route pages (#15): the page frame and head, panels, callouts, mark lists,
// empty and locked states, settings rows, the simulated-channel tag and the source excerpt panel.
// Plain components without state, so server and client components can both use them.

import { type LucideIcon, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import type { Lesson, Resource } from "../../../contracts/index.ts";
import styles from "./blocks.module.css";
import { cx, LangBadge, LicenceTag, Sep } from "./ui.tsx";

// ===================================================================== page frame

export type PageWidth = "wide" | "narrow" | "reading";

// The column a route page lives in: centred, clear of the trace tab on the left edge.
export function Page({ width = "wide", children }: { width?: PageWidth; children: ReactNode }) {
  return <div className={cx(styles.page, styles[width])}>{children}</div>;
}

// One icon-led item in a page head's meta line.
export function MetaItem({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className={styles.metaItem}>
      <Icon aria-hidden />
      {children}
    </span>
  );
}

// The page's one h1, with an optional pill beside it, a meta line, a lede and actions.
export function PageHead({
  title,
  pill,
  meta,
  lede,
  actions,
}: {
  title: ReactNode;
  pill?: ReactNode;
  meta?: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {pill}
        </div>
        {meta && <div className={styles.meta}>{meta}</div>}
        {lede && <p className={styles.lede}>{lede}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

// Two columns, the first wider; one column below laptop width.
export function Columns({ children }: { children: ReactNode }) {
  return <div className={styles.cols}>{children}</div>;
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

// A titled container: one elevation (a hairline edge). `flush` drops the padding for SettingRows.
export function Panel({
  id,
  title,
  sub,
  aside,
  flush = false,
  children,
}: {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cx(styles.panel, flush && styles.flush)} aria-labelledby={id}>
      <div className={styles.panelHead}>
        <div className={styles.panelHeadText}>
          <h2 className={styles.panelTitle} id={id}>
            {title}
          </h2>
          {sub && <p className={styles.panelSub}>{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ===================================================================== text blocks

export type CalloutTone = "neutral" | "accent" | "attention" | "ready";

// A short note on a tinted fill (never a coloured side stripe).
export function Callout({
  icon: Icon,
  tone = "neutral",
  children,
}: {
  icon: LucideIcon;
  tone?: CalloutTone;
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.callout, styles[`callout_${tone}`])}>
      <Icon aria-hidden />
      <p>{children}</p>
    </div>
  );
}

export type MarkTone = "neutral" | "ready" | "attention";

// A list of marked lines: a round mark (icon or number), a title with detail, and a value or pill.
export function MarkList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className={styles.marks} aria-label={label}>
      {children}
    </ul>
  );
}

export function MarkItem({
  mark,
  tone = "neutral",
  title,
  detail,
  value,
}: {
  mark: ReactNode;
  tone?: MarkTone;
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <li className={styles.markItem}>
      <span className={cx(styles.mark, styles[`mark_${tone}`])} aria-hidden>
        {mark}
      </span>
      <span className={styles.markText}>
        <span className={styles.markTitle}>{title}</span>
        {detail && <span className={styles.markDetail}>{detail}</span>}
      </span>
      {value !== undefined && <span className={styles.markValue}>{value}</span>}
    </li>
  );
}

// An empty, locked or not-yet-built state. `inline` sits inside a panel on a grey fill. Its title
// is an h2 under the page head, or the page's h1 (`heading="h1"`) on a page that has no head.
export function EmptyState({
  icon: Icon,
  title,
  text,
  actions,
  preview,
  inline = false,
  titleId,
  heading: Heading = "h2",
}: {
  icon: LucideIcon;
  title?: string;
  text: ReactNode;
  actions?: ReactNode;
  preview?: ReactNode;
  inline?: boolean;
  titleId?: string;
  heading?: "h1" | "h2";
}) {
  const body = (
    <>
      <span className={styles.emptyIcon} aria-hidden>
        <Icon />
      </span>
      {title && (
        <Heading className={styles.emptyTitle} id={titleId}>
          {title}
        </Heading>
      )}
      <p className={styles.emptyText}>{text}</p>
      {actions && <div className={styles.emptyActions}>{actions}</div>}
      {preview && <div className={styles.emptyPreview}>{preview}</div>}
    </>
  );
  return inline ? (
    <div className={cx(styles.empty, styles.emptyInline)}>{body}</div>
  ) : (
    <section className={styles.empty} aria-labelledby={titleId}>
      {body}
    </section>
  );
}

// ===================================================================== settings rows

export function SettingRows({ children }: { children: ReactNode }) {
  return <div className={styles.rows}>{children}</div>;
}

// A label and help on the start side, its control on the end side. `htmlFor` labels a form
// control; otherwise `labelId` names a group (pass it to the group's aria-labelledby).
export function SettingRow({
  label,
  htmlFor,
  labelId,
  help,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        {htmlFor ? (
          <label className={styles.rowLabel} htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <p className={styles.rowLabel} id={labelId}>
            {label}
          </p>
        )}
        {help && <p className={styles.rowHelp}>{help}</p>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

// ===================================================================== small marks

// Coach messages go to a simulated phone only (ADR-004).
export function ChannelTag() {
  return (
    <span className={styles.channel}>
      <Smartphone aria-hidden />
      قناة محاكاة
    </span>
  );
}

// ===================================================================== source excerpt

type Excerpt = Lesson["sections"][number]["source_excerpt"];

const RESOURCE_TYPE: Record<Resource["type"], string> = {
  article: "مقال",
  video: "فيديو",
  book: "كتاب",
  course: "دورة",
};

// The original text beside the Arabic: language, locator and licence on top, the excerpt in its
// own direction, then a catalogue-style source mark (call mark, original title, type, address).
export function SourceExcerpt({
  excerpt,
  resource,
}: {
  excerpt: Excerpt;
  resource: Resource | undefined;
}) {
  return (
    <figure className={styles.excerpt}>
      <div className={styles.excerptHead}>
        <LangBadge lang={excerpt.lang} full />
        <span className={styles.locator} dir="ltr" lang="en" title="موضع النص في المصدر">
          {excerpt.locator}
        </span>
        {resource && (
          <span className={styles.excerptLicence}>
            <LicenceTag spdx={resource.licence.spdx} verified={resource.licence.verified} />
          </span>
        )}
      </div>
      <blockquote className={styles.excerptText} lang={excerpt.lang} dir="ltr">
        {excerpt.text}
      </blockquote>
      {resource && (
        <figcaption className={styles.cite}>
          <span className={styles.callMark} dir="ltr" lang="en" title="رمز المصدر">
            {resource.id.toUpperCase()}
            <span className={styles.callMarkLang}>{resource.lang.toUpperCase()}</span>
          </span>
          <span className={styles.citeText}>
            <bdi className={styles.citeTitle} lang={resource.lang}>
              {resource.title}
            </bdi>
            <span className={styles.citeMeta}>
              {RESOURCE_TYPE[resource.type]}
              <Sep />
              مصدر تجريبي
              <Sep />
              <a
                href={resource.url}
                title={resource.url}
                dir="ltr"
                lang="en"
                target="_blank"
                rel="noopener noreferrer"
              >
                {resource.url.replace(/^https?:\/\//, "")}
                <span className="sr-only"> (يفتح في نافذة جديدة)</span>
              </a>
            </span>
          </span>
        </figcaption>
      )}
    </figure>
  );
}
