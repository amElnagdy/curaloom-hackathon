"use client";

// The lesson's client side (#19). LessonBuilding asks the server for the lesson until it is written
// and shows the page again; the page's lede, status and body read from it whether writing failed.
// Terms keeps one glossary card open at a time: a term opens its card on hover with a fine pointer,
// or on a click, tap, Enter or Space, which pin it; Escape, the close button or a click or tap
// elsewhere closes it. While a card is open, the source term is marked in the excerpt beside it.

import { ArrowRight, Copy, Hourglass, RotateCcw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { GlossaryEntry } from "../../../contracts/index.ts";
import { Callout } from "../_shell/blocks.tsx";
import {
  BidiText,
  buttonClass,
  DirIcon,
  LANG_NAMES,
  LangBadge,
  StatusPill,
} from "../_shell/ui.tsx";
import { useBuild } from "../_shell/use-build.ts";
import styles from "./lesson.module.css";

const Writing = createContext({ failed: false, done: false, retry: () => {} });

export function LessonBuilding({
  sessionId,
  lessonId,
  build,
  children,
}: {
  sessionId: string;
  lessonId: string;
  build: boolean;
  children: ReactNode;
}) {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/lessons/${encodeURIComponent(lessonId)}`;
  return <Writing value={useBuild(build ? url : null)}>{children}</Writing>;
}

export function WritingLede({ name }: { name: string }) {
  const { failed } = useContext(Writing);
  if (failed) return <b>لم نتمكن من كتابة درسك هذه المرة يا {name}.</b>;
  return (
    <>
      <b>نكتب درسك الآن يا {name}.</b> يقرأ صانع الدروس مصادر الدرس ويختار منها مقتطفات قصيرة يشرحها
      لك بالعربية. قد يستغرق ذلك دقيقة.
    </>
  );
}

export function WritingStatus() {
  const { failed } = useContext(Writing);
  return failed ? (
    <StatusPill status="failed">تعذّرت الكتابة</StatusPill>
  ) : (
    <StatusPill status="building">يُكتب الآن</StatusPill>
  );
}

// Under the plan page's start button while the first lesson is written. A retry moves focus to the
// page's title, as the button goes with the failure.
export function WritingHint({
  className,
  titleId,
}: {
  className: string | undefined;
  titleId: string;
}) {
  const { failed, retry } = useContext(Writing);
  return failed ? (
    <p className={className} data-failed role="alert">
      <TriangleAlert aria-hidden />
      تعذّرت كتابة الدرس الأول.
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => {
          document.getElementById(titleId)?.focus();
          retry();
        }}
      >
        حاول مرة أخرى
      </button>
    </p>
  ) : (
    <p className={className} data-locked>
      <Hourglass aria-hidden />
      يكتب صانع الدروس الدرس الأول الآن
    </p>
  );
}

// The foot of the learner's lesson (#20). While the lesson has no quiz (`build`), it asks the
// examiner for one as soon as the lesson is shown, so it is ready by the time he finishes reading;
// then it shows `children`, the way to the quiz, and says the quiz is ready.
export function QuizBuilding({
  sessionId,
  lessonId,
  build,
  children,
}: {
  sessionId: string;
  lessonId: string;
  build: boolean;
  children: ReactNode;
}) {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/quizzes/${encodeURIComponent(lessonId)}`;
  const { failed, done, retry } = useBuild(build ? url : null);
  const note = useRef<HTMLParagraphElement>(null);
  return (
    <>
      {build ? (
        <footer className={styles.footer}>
          {failed ? (
            <p key="failed" className={styles.footNote} data-failed role="alert">
              <TriangleAlert aria-hidden />
              تعذّرت كتابة اختبار هذا الدرس هذه المرة.
            </p>
          ) : (
            <p key="writing" ref={note} className={styles.footNote} tabIndex={-1}>
              <Hourglass aria-hidden />
              يكتب الممتحن اختبار هذا الدرس الآن، ويجهز وأنت تقرأ.
            </p>
          )}
          {failed ? (
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={() => {
                // The button goes with the failure; focus moves to the note that replaces it, which
                // keeps the reader at the foot of a long lesson.
                flushSync(retry);
                note.current?.focus();
              }}
            >
              <RotateCcw aria-hidden />
              حاول مرة أخرى
            </button>
          ) : (
            <Link href="/quiz" className={buttonClass("secondary")}>
              إلى الاختبار
              <DirIcon icon={ArrowRight} />
            </Link>
          )}
        </footer>
      ) : (
        children
      )}
      <p role="status" className="sr-only">
        {done ? "اختبار الدرس جاهز." : ""}
      </p>
    </>
  );
}

// Says the lesson has arrived, which the page shows in place of its shape without moving focus.
export function WritingDone() {
  const { done } = useContext(Writing);
  return (
    <p role="status" className="sr-only">
      {done ? "درسك جاهز." : ""}
    </p>
  );
}

export function WritingBody() {
  const { failed, retry } = useContext(Writing);
  if (failed) {
    return (
      <div className={styles.writeFailed} role="alert">
        <Callout icon={TriangleAlert} tone="attention">
          تعذّرت كتابة درسك هذه المرة، وخطتك محفوظة كما هي. حاول مرة أخرى بعد قليل.
        </Callout>
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={() => {
            // The button goes with the failure; focus moves to the page's title, not the body.
            document.getElementById("lesson-title")?.focus();
            retry();
          }}
        >
          <RotateCcw aria-hidden />
          حاول مرة أخرى
        </button>
      </div>
    );
  }
  return (
    <div className={styles.lesson} aria-busy="true">
      <div className={styles.skeleton} data-size="objectives" />
      {[0, 1].map((i) => (
        <div key={i} className={styles.section}>
          <div className={styles.skeleton} data-size="text" />
          <div className={styles.skeleton} data-size="excerpt" />
        </div>
      ))}
    </div>
  );
}

type Open = { key: string; id: string; section: number; pinned: boolean };
type Cards = {
  open: Open | null;
  show(open: Open): void;
  hide(): void;
  // Runs `action` after `ms`, in place of any action waiting. One timer serves every term, so the
  // term the pointer left cannot close the card of the term it moved to.
  later(action: (() => void) | null, ms?: number): void;
};

const CardsContext = createContext<Cards>({
  open: null,
  show: () => {},
  hide: () => {},
  later: () => {},
});

const termId = (key: string) => `term-${key}`;
const cardId = (key: string) => `card-${key}`;

export function Terms({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const hide = useCallback(() => setOpen(null), []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = useCallback((action: (() => void) | null, ms = 0) => {
    clearTimeout(timer.current);
    if (action) timer.current = setTimeout(action, ms);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    // iOS sends no click for a tap on plain text, and a scroll ends in pointercancel, not pointerup.
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest(`.${styles.term}, .${styles.card}`)) hide();
    };
    // In the capture phase, so the card takes the Escape before the trace drawer sees it.
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const inside = document.getElementById(cardId(open.key))?.contains(document.activeElement);
      hide();
      if (inside) document.getElementById(termId(open.key))?.focus();
    };
    document.addEventListener("pointerup", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerup", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, hide]);

  return <CardsContext value={{ open, show: setOpen, hide, later }}>{children}</CardsContext>;
}

const OPEN_DELAY_MS = 140;
const CLOSE_DELAY_MS = 220;
const MARGIN = 12;
const CARD_WIDTH = 344;

// Below the term's last line unless only the space above its first fits the card. RTL: the card's
// right edge lines up with where the term starts on that line, its rightmost box (a line holds a
// box for each run of text), kept inside the viewport.
function place(card: HTMLElement, term: HTMLElement) {
  const rects = [...term.getClientRects()];
  const first = rects[0];
  const last = rects.at(-1);
  const box = card.offsetParent?.getBoundingClientRect();
  if (!first || !last || !box) return;
  const vw = document.documentElement.clientWidth;
  const width = Math.min(CARD_WIDTH, vw - MARGIN * 2);
  card.style.width = `${width}px`;
  const height = card.offsetHeight;
  const above = innerHeight - last.bottom < height + 16 && first.top > height + 16;
  const line = above ? first : last;
  const start = Math.max(
    ...rects.filter((r) => r.top < line.bottom && r.bottom > line.top).map((r) => r.right),
  );
  const left = Math.max(MARGIN, Math.min(start - width, vw - MARGIN - width));
  const top = above ? first.top - 10 - height : last.bottom + 10;
  card.style.left = `${left - box.left}px`;
  card.style.top = `${top - box.top}px`;
  card.dataset.side = above ? "above" : "below";
  card.style.setProperty("--arrow", `${Math.max(18, Math.min(start - 22 - left, width - 18))}px`);
}

// One glossary term in the Arabic text. `index` tells apart the terms of a section.
export function Term({
  entry,
  section,
  index,
  children,
}: {
  entry: GlossaryEntry;
  section: number;
  index: number;
  children: ReactNode;
}) {
  const { open, show, hide, later } = useContext(CardsContext);
  const key = `${section}-${index}`;
  const isOpen = open?.key === key;
  const termRef = useRef<HTMLAnchorElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      if (cardRef.current && termRef.current) place(cardRef.current, termRef.current);
    };
    reposition();
    addEventListener("resize", reposition);
    return () => removeEventListener("resize", reposition);
  }, [isOpen]);

  const pin = () => {
    later(null);
    if (isOpen && open?.pinned) hide();
    else show({ key, id: entry.id, section, pinned: true });
  };
  const hover = (enter: boolean) => {
    if (open?.pinned) return;
    if (enter) later(() => show({ key, id: entry.id, section, pinned: false }), OPEN_DELAY_MS);
    else later(hide, CLOSE_DELAY_MS);
  };
  // Hover opens a card only for a mouse; a tap is a click.
  const mouse = (e: React.PointerEvent) =>
    e.pointerType === "mouse" && matchMedia("(pointer: fine)").matches;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: an anchor wraps across lines with the text around it, and a button does not */}
      <a
        ref={termRef}
        id={termId(key)}
        href={`#glossary-${entry.id}`}
        role="button"
        className={styles.term}
        aria-expanded={isOpen}
        aria-controls={cardId(key)}
        onClick={(e) => {
          e.preventDefault();
          pin();
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== " ") return;
          e.preventDefault();
          pin();
        }}
        onPointerEnter={(e) => mouse(e) && hover(true)}
        onPointerLeave={(e) => mouse(e) && hover(false)}
      >
        {children}
      </a>
      <span
        ref={cardRef}
        id={cardId(key)}
        className={styles.card}
        hidden={!isOpen}
        onPointerEnter={() => later(null)}
        onPointerLeave={(e) => mouse(e) && hover(false)}
      >
        <span className={styles.cardArrow} aria-hidden />
        <span className={styles.cardHead}>
          <span className={styles.cardWord}>{entry.ar_diacritized}</span>
          <button
            type="button"
            className={buttonClass("ghost", "sm", { iconOnly: true })}
            aria-label="أغلق"
            onClick={() => {
              hide();
              termRef.current?.focus();
            }}
          >
            <X aria-hidden />
          </button>
        </span>
        <span className={styles.cardSource}>
          <LangBadge lang={entry.src.lang} />
          <bdi lang={entry.src.lang}>{entry.src.term}</bdi>
          <span className={styles.cardSourceNote}>في المصدر ب{LANG_NAMES[entry.src.lang]}</span>
        </span>
        <span className={styles.cardText}>
          <BidiText text={entry.definition_ar} />
        </span>
        <span className={styles.cardExample}>
          <b>مثال:</b> <BidiText text={entry.example_ar} />
        </span>
        <a href={`#glossary-${entry.id}`} className={styles.cardMore} onClick={hide}>
          في مسرد الدرس
          <DirIcon icon={ArrowRight} />
        </a>
      </span>
    </>
  );
}

// A source term in the excerpt, marked while its card in the same section is open.
export function ExcerptMark({
  id,
  section,
  children,
}: {
  id: string;
  section: number;
  children: ReactNode;
}) {
  const { open } = useContext(CardsContext);
  const lit = open?.id === id && open.section === section;
  return lit ? <mark className={styles.excerptMark}>{children}</mark> : children;
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("ghost", "sm", { className: styles.copy })}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        )
      }
    >
      <Copy aria-hidden />
      <span aria-live="polite">{copied ? "نُسخ نص الإسناد" : "انسخ نص الإسناد"}</span>
    </button>
  );
}
