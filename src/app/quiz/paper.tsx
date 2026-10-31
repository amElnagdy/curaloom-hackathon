"use client";

// The quiz's client side (#20). QuizWriter asks the examiner for the lesson's quiz while there is
// none, or for a new one once the learner asks after an attempt below the gate; the page's pill,
// lede and body read from it whether it is writing. QuizPaper is the quiz to take: every item on
// one page, a sticky bar to submit, then the grading status until the graded page arrives. The
// plan page gives it the comeback's recap (#27), with its own address and texts.

import { Info, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type { KeylessQuiz } from "../../server/agents/examiner/rules.ts";
import { Callout } from "../_shell/blocks.tsx";
import { arabicNumber } from "../_shell/format.ts";
import { BidiText, buttonClass, cx, Meta, RecordedFill, StatusPill } from "../_shell/ui.tsx";
import { useBuild } from "../_shell/use-build.ts";
import styles from "./quiz.module.css";

export const TITLE_ID = "quiz-title";
export const RESULT_ID = "result-title";
// Set by a submit the server graded, so the graded page moves focus to its result. The module keeps
// it too, for a browser whose sessionStorage throws.
const GRADED = "quiz-graded";
let gradedQuiz: string | null = null;
const draftKey = (quizId: string) => `quiz-draft:${quizId}`;

const quizUrl = (sessionId: string, lessonId: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/quizzes/${encodeURIComponent(lessonId)}`;

type Writing = { writing: boolean; failed: boolean; done: boolean; start(): void; retry(): void };
const WritingContext = createContext<Writing>({
  writing: false,
  failed: false,
  done: false,
  start: () => {},
  retry: () => {},
});

// `quizId` is the lesson's latest quiz: a new one asked for replaces it, and the writing is over
// once the page shows another.
export function QuizWriter({
  sessionId,
  lessonId,
  quizId,
  build,
  children,
}: {
  sessionId: string;
  lessonId: string;
  quizId: string | undefined;
  build: boolean;
  children: ReactNode;
}) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const writing = build || (replacing !== null && replacing === quizId);
  const { failed, done, retry } = useBuild(writing ? quizUrl(sessionId, lessonId) : null);
  const start = () => setReplacing(quizId ?? null);
  return (
    <WritingContext value={{ writing, failed, done, start, retry }}>{children}</WritingContext>
  );
}

// `writing` in place of the children while the examiner writes the quiz.
export function WhileWriting({ writing, children }: { writing: ReactNode; children: ReactNode }) {
  return useContext(WritingContext).writing ? writing : children;
}

export function WritingPill() {
  return useContext(WritingContext).failed ? (
    <StatusPill status="failed">تعذّرت الكتابة</StatusPill>
  ) : (
    <StatusPill status="building">يُكتب الآن</StatusPill>
  );
}

export function WritingLede() {
  if (useContext(WritingContext).failed) return <b>لم نتمكن من كتابة اختبارك هذه المرة.</b>;
  return (
    <>
      <b>يكتب الممتحن أسئلة اختبارك الآن.</b> يكتبها من الدرس نفسه، ويتحقق محكّم من مفاتيحها، وعادة
      ما تجهز وأنت تقرأ الدرس. تظهر هنا حين تكتمل.
    </>
  );
}

// Says the quiz has arrived, which the page shows in place of its shape without moving focus.
export function WritingDone() {
  return (
    <p role="status" className="sr-only">
      {useContext(WritingContext).done ? "اختبارك جاهز." : ""}
    </p>
  );
}

export function WritingBody() {
  const { failed, retry } = useContext(WritingContext);
  if (failed) {
    return (
      <div className={styles.writeFailed} role="alert">
        <Callout icon={TriangleAlert} tone="attention">
          تعذّرت كتابة الاختبار هذه المرة، ودرسك ونتائجك محفوظة كما هي. حاول مرة أخرى بعد قليل.
        </Callout>
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={() => {
            // The button goes with the failure; focus moves to the page's title, not the body.
            document.getElementById(TITLE_ID)?.focus();
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
    <div className={styles.items} aria-busy="true">
      {[4, 4, 0].map((options, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder shape
        <div key={i} className={cx(styles.q, styles.skq)}>
          <div className={styles.skHead}>
            <span className={cx(styles.skeleton, styles.skNum)} />
            <span className={cx(styles.skeleton, styles.skLine)} />
          </div>
          <div className={styles.skBody}>
            {options ? (
              Array.from({ length: options }, (_, o) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder shape
                <span key={o} className={cx(styles.skeleton, styles.skOpt)} />
              ))
            ) : (
              <span className={cx(styles.skeleton, styles.skOpt)} style={{ height: "7.5rem" }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// The result's «ابدأ اختبارًا جديدًا»: the page shows the examiner writing until the new quiz is in.
export function NewQuizButton() {
  const { start } = useContext(WritingContext);
  return (
    <button
      type="button"
      className={buttonClass("primary", "lg")}
      onClick={() => {
        // The button goes with the result; focus moves to the page's title.
        document.getElementById(TITLE_ID)?.focus();
        start();
      }}
    >
      <RotateCcw aria-hidden />
      ابدأ اختبارًا جديدًا
    </button>
  );
}

// On the graded page, moves focus to the result when the learner's submit led here. The plan page
// moves it to the proposal its recap led to.
export function FocusOnArrival({
  quizId,
  headingId = RESULT_ID,
}: {
  quizId: string;
  headingId?: string;
}) {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(GRADED);
      if (stored === quizId) sessionStorage.removeItem(GRADED);
    } catch {}
    const arrived = gradedQuiz === quizId || stored === quizId;
    if (gradedQuiz === quizId) gradedQuiz = null;
    if (!arrived) return;
    const heading = document.getElementById(headingId);
    heading?.focus({ preventScroll: true });
    heading?.closest("section")?.scrollIntoView({ block: "start" });
  }, [quizId, headingId]);
  return null;
}

type Answers = Record<string, string>;
type Phase = "answering" | "grading" | "failed";

// A draft saved for this quiz, without answers it cannot take.
function readDraft(quiz: KeylessQuiz): Answers {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(draftKey(quiz.id)) ?? "{}");
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(
      quiz.items.flatMap((item) => {
        const value = (saved as Record<string, unknown>)[item.id];
        if (typeof value !== "string") return [];
        if (item.type === "mcq" && !item.options_ar.includes(value)) return [];
        return [[item.id, value]];
      }),
    );
  } catch {
    return {};
  }
}

function writeDraft(quizId: string, answers: Answers | null) {
  try {
    if (answers) sessionStorage.setItem(draftKey(quizId), JSON.stringify(answers));
    else sessionStorage.removeItem(draftKey(quizId));
  } catch {
    // A private window keeps no draft; the quiz still works.
  }
}

const itemName = (index: number) => `السؤال ${arabicNumber(index + 1)}`;

// «أ»، «ب» و«ج».
function andList(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, i) => {
    if (i === 0) return [part];
    return [i === parts.length - 1 ? " و" : "، ", part];
  });
}

function readingShorts(count: number): string {
  if (count === 1) return "يقرأ الممتحن إجابتك القصيرة";
  if (count === 2) return "يقرأ الممتحن إجابتيك القصيرتين";
  return "يقرأ الممتحن إجاباتك القصيرة";
}

// What the paper says while it grades, in place of a lesson quiz's texts.
export type GradingText = { title: string; step: string; detail: string };

export function QuizPaper({
  quiz,
  sessionId,
  lessonId,
  note,
  submitUrl,
  intro,
  grading,
  recorded,
}: {
  quiz: KeylessQuiz;
  sessionId: string;
  lessonId: string;
  // Over a new quiz after an attempt below the gate.
  note?: string;
  // Where the answers go, when not to the lesson's attempts.
  submitUrl?: string;
  // In place of the note on how the quiz is graded.
  intro?: string;
  grading?: GradingText;
  // Replay only: the recorded run's short answers, in the order of the short items (#30).
  recorded?: readonly string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [answers, setAnswers] = useState<Answers>({});
  const [phase, setPhase] = useState<Phase>("answering");
  const [nudged, setNudged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const statusRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const abort = useRef<AbortController | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a refresh hands a new copy of the same quiz, whose draft is already in the form
  useEffect(() => setAnswers(readDraft(quiz)), [quiz.id]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (phase !== "answering") statusRef.current?.focus();
  }, [phase]);
  // The status heading that had focus goes with the grading.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const answered = (id: string) => Boolean(answers[id]?.trim());
  const left = quiz.items.filter((item) => !answered(item.id));
  const count = quiz.items.length - left.length;
  const shortItems = quiz.items.filter((item) => item.type === "short");
  const shorts = shortItems.length;
  const locked = phase !== "answering";

  const answer = (id: string, value: string) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    writeDraft(quiz.id, next);
    setError(null);
  };

  const jump = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const card = document.getElementById(`q-${id}`);
    card?.scrollIntoView({ block: "center" });
    card?.querySelector<HTMLElement>("input:checked, input, textarea")?.focus({
      preventScroll: true,
    });
  };

  async function send() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase("grading");
    setError(null);
    setSaid(grading ? `سُلّمت إجاباتك. ${grading.step}.` : "سُلّمت إجاباتك، ويصححها الممتحن الآن.");
    const body = JSON.stringify({
      quiz_id: quiz.id,
      answers: quiz.items.map((item) => ({ item_id: item.id, response: answers[item.id] ?? "" })),
    });
    while (!controller.signal.aborted) {
      const res = await fetch(submitUrl ?? `${quizUrl(sessionId, lessonId)}/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      // While another request grades this session's attempt, the server answers 409 with
      // Retry-After; a 409 without it means the quiz is no longer the one to take.
      const wait = res?.status === 409 && Number(res.headers.get("retry-after"));
      if (wait) {
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      if (res?.ok || res?.status === 409) {
        if (res.ok) {
          writeDraft(quiz.id, null);
          gradedQuiz = quiz.id;
          try {
            sessionStorage.setItem(GRADED, quiz.id);
          } catch {}
        }
        startTransition(() => {
          // A refresh that still shows this quiz leaves it to answer, not locked.
          if (!res.ok) setPhase("answering");
          router.refresh();
        });
        return;
      }
      if (res?.status === 400) {
        setPhase("answering");
        setError("لم نتمكن من تسليم إجاباتك كما هي. راجع إجاباتك، ثم سلّمها مرة أخرى.");
        return;
      }
      setPhase("failed");
      setSaid("تعذّر تصحيح إجاباتك. إجاباتك محفوظة، ويمكنك أن تطلب التصحيح مرة أخرى.");
      return;
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (left.length) {
      setNudged(true);
      setSaid(
        `لم تُجب بعد عن ${left.map((item) => itemName(quiz.items.indexOf(item))).join("، ")}.`,
      );
      return;
    }
    setNudged(false);
    send();
  };

  return (
    <>
      {phase !== "answering" && (
        <section className={styles.result} aria-labelledby="quiz-status-title">
          <h2 className={styles.resultTitle} id="quiz-status-title" tabIndex={-1} ref={statusRef}>
            {phase === "grading" ? (grading?.title ?? "نصحح إجاباتك") : "لم يكتمل التصحيح"}
          </h2>
          {phase === "grading" ? (
            <div className={cx(styles.step, styles.busy)}>
              <span className={styles.stepMark} aria-hidden />
              <div className={styles.stepText}>
                <b>{grading?.step ?? readingShorts(shorts)}</b>
                <p>
                  {grading?.detail ??
                    "يقارن كل إجابة بمعيار مكتوب، وتظهر نتيجتك هنا حين يكتمل التصحيح. قد يستغرق ذلك بضع ثوانٍ."}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className={cx(styles.step, styles.fail)}>
                <span className={styles.stepMark}>
                  <TriangleAlert aria-hidden />
                </span>
                <div className={styles.stepText}>
                  <b>تعذّر التصحيح هذه المرة</b>
                  <p>إجاباتك محفوظة كما كتبتها، فلا تحتاج إلى كتابتها من جديد.</p>
                </div>
              </div>
              <div className={styles.resultActions}>
                <button type="button" className={buttonClass("secondary")} onClick={send}>
                  <RotateCcw aria-hidden />
                  صحّح مرة أخرى
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <form className={styles.paper} onSubmit={submit} noValidate aria-busy={phase === "grading"}>
        <h2 className="sr-only">أسئلة الاختبار</h2>
        {phase === "answering" && note && (
          <Callout icon={RotateCcw} tone="accent">
            {note}
          </Callout>
        )}
        {phase === "answering" && (
          <Callout icon={Info}>
            {intro ??
              "لكل سؤال درجة واحدة، ونتيجتك متوسط درجاتك. أسئلة الاختيار يصححها الكود بمفتاحها، والإجابات القصيرة يقرؤها الممتحن ويصححها وفق معيار مكتوب."}
          </Callout>
        )}
        <ol className={styles.items}>
          {quiz.items.map((item, i) => {
            const card = cx(
              styles.q,
              answered(item.id) && styles.answered,
              nudged && !answered(item.id) && styles.missing,
            );
            const num = (
              <span className={styles.qNum} aria-hidden>
                {arabicNumber(i + 1)}
              </span>
            );
            // Inside the legend or label, so a field reached from the nudge says its item too.
            const name = <span className="sr-only">{itemName(i)}: </span>;
            const missing = nudged && !answered(item.id) && (
              <span className={styles.qMissing}>بلا إجابة</span>
            );
            if (item.type === "mcq") {
              return (
                <li key={item.id}>
                  <fieldset className={card} id={`q-${item.id}`} disabled={locked}>
                    <legend className={styles.qLegend}>
                      <span className={styles.qHead}>
                        {num}
                        <span className={styles.qPrompt}>
                          {name}
                          <BidiText text={item.prompt_ar} />
                        </span>
                      </span>
                    </legend>
                    <div className={styles.qMeta}>
                      <Meta parts={["اختيار من متعدد", "درجة واحدة"]} />
                      {missing}
                    </div>
                    <div className={styles.qBody}>
                      <div className={styles.opts}>
                        {item.options_ar.map((option) => (
                          <label key={option} className={styles.opt}>
                            <input
                              type="radio"
                              name={item.id}
                              value={option}
                              checked={answers[item.id] === option}
                              onChange={() => answer(item.id, option)}
                            />
                            <span className={styles.optText}>
                              <BidiText text={option} />
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                </li>
              );
            }
            const recordedText = recorded?.[shortItems.indexOf(item)];
            return (
              <li key={item.id}>
                <div className={card} id={`q-${item.id}`}>
                  <div className={styles.qHead}>
                    {num}
                    <label className={styles.qPrompt} htmlFor={`ta-${item.id}`}>
                      {name}
                      <BidiText text={item.prompt_ar} />
                    </label>
                  </div>
                  <div className={styles.qMeta}>
                    <Meta parts={["إجابة قصيرة", "درجة واحدة", "يصححها الممتحن"]} />
                    {missing}
                  </div>
                  <div className={styles.qBody}>
                    <div>
                      <textarea
                        className={styles.ta}
                        id={`ta-${item.id}`}
                        name={item.id}
                        rows={4}
                        dir="rtl"
                        maxLength={2000}
                        aria-describedby={`hint-${item.id}`}
                        value={answers[item.id] ?? ""}
                        onChange={(e) => answer(item.id, e.target.value)}
                        disabled={locked}
                      />
                      <p className={styles.hint} id={`hint-${item.id}`}>
                        اكتب بكلماتك، بالفصحى أو بلهجتك.
                      </p>
                      {recordedText !== undefined &&
                        !locked &&
                        answers[item.id] !== recordedText && (
                          <div className={styles.recorded}>
                            <RecordedFill
                              label="املأ الإجابة المسجّلة"
                              onFill={() => answer(item.id, recordedText)}
                            />
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {phase === "answering" && (
          <div className={styles.submitBar}>
            {nudged && left.length > 0 && (
              <p className={styles.notice}>
                لم تُجب بعد عن{" "}
                {andList(
                  left.map((item) => (
                    <a key={item.id} href={`#q-${item.id}`} onClick={(e) => jump(e, item.id)}>
                      {itemName(quiz.items.indexOf(item))}
                    </a>
                  )),
                )}
                . أجب عنها كلها لتسلّم إجاباتك.
              </p>
            )}
            {error && (
              <p className={styles.notice} role="alert" tabIndex={-1} ref={errorRef}>
                {error}
              </p>
            )}
            <div className={styles.barRow}>
              <div className={styles.progress}>
                <p className={styles.progressText}>
                  {count === 0
                    ? "لم تُجب عن أي سؤال بعد"
                    : `${arabicNumber(count)} من ${arabicNumber(quiz.items.length)} أُجيبت`}
                </p>
                <span className={styles.ticks} aria-hidden>
                  {quiz.items.map((item) => (
                    <span key={item.id} className={answered(item.id) ? styles.tickOn : undefined} />
                  ))}
                </span>
              </div>
              <button type="submit" className={buttonClass("primary")}>
                سلّم الإجابات
              </button>
            </div>
          </div>
        )}
      </form>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </>
  );
}
