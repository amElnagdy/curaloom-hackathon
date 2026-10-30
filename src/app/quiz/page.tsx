// The quiz (#20) for the first lesson of the learner's plan, the lesson the lesson page shows. The
// whole quiz sits on one page; once graded, the result is at the top with the next lesson open or
// locked, and each item shows its grade and the examiner's feedback in place. Before the intake it
// shows the seed's graded quiz as an example; with the lesson written and no quiz yet, the page asks
// the examiner for it.

import {
  ArrowRight,
  BookA,
  BookOpen,
  Check,
  CircleCheck,
  ClipboardCheck,
  Gauge,
  Info,
  Lock,
  LockOpen,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type {
  CoursePlan,
  GlossaryEntry,
  Lesson,
  Quiz,
  QuizAttempt,
} from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { planFor } from "../../server/agents/architect/architect.ts";
import { PASS_THRESHOLD, quizView, savedQuizzes } from "../../server/agents/examiner/examiner.ts";
import { type QuizView, withoutKeys } from "../../server/agents/examiner/rules.ts";
import { savedProfile } from "../../server/agents/intake/intake.ts";
import { savedLessons } from "../../server/agents/lesson/lesson.ts";
import { termMarks } from "../../server/agents/lesson/rules.ts";
import { createFileStore } from "../../server/store/store.ts";
import { Callout, EmptyState, MetaItem, Page, PageHead } from "../_shell/blocks.tsx";
import { firstLesson, latestPlan } from "../_shell/course.ts";
import {
  ATTEMPTS,
  arabicNumber,
  countOf,
  ordinal,
  ordinalF,
  percent,
  QUESTIONS,
} from "../_shell/format.ts";
import { BidiText, buttonClass, cx, DirIcon, StatusPill } from "../_shell/ui.tsx";
import {
  FocusOnArrival,
  NewQuizButton,
  QuizPaper,
  QuizWriter,
  RESULT_ID,
  TITLE_ID,
  WhileWriting,
  WritingBody,
  WritingDone,
  WritingLede,
  WritingPill,
} from "./paper.tsx";
import styles from "./quiz.module.css";

export const metadata: Metadata = { title: "الاختبار" };

type Item = Quiz["items"][number];
type Graded = QuizAttempt["answers"][number];

// The lesson the quiz is on: its place in the plan, its glossary entries, its quizzes and attempts,
// and the lesson after it in the plan.
type Course = {
  plan: CoursePlan | undefined;
  lesson: Lesson;
  position: number;
  glossary: GlossaryEntry[];
  view: QuizView;
  next: { title: string; position: number } | undefined;
};

// What the page shows: nothing before the lesson is written, the examiner writing the quiz, the
// quiz to take, or the latest quiz graded (the seed's, as a `sample`, before the intake).
type Shown =
  | { kind: "waiting" }
  | ({ kind: "writing" } & Course)
  | ({ kind: "answering"; quiz: Quiz } & Course)
  | ({ kind: "result"; sample: boolean; quiz: Quiz; attempt: QuizAttempt } & Course);

function courseOf(
  plan: CoursePlan | undefined,
  lesson: Lesson,
  glossary: GlossaryEntry[],
  view: QuizView,
): Course {
  const lessons = plan?.committed.lessons ?? [];
  const position = Math.max(
    0,
    lessons.findIndex((l) => l.id === lesson.id),
  );
  const next = lessons[position + 1];
  return {
    plan,
    lesson,
    position,
    glossary: lesson.glossary_ids.flatMap((id) => glossary.filter((g) => g.id === id)),
    view,
    next: next && { title: next.title_ar, position: position + 1 },
  };
}

function shownQuiz(): Shown {
  const store = createFileStore();
  const seed = loadOmarSeed(config.demoTopic);
  const learner = savedProfile(store, DEMO_SESSION_ID);
  if (!learner) {
    const plan = latestPlan(seed);
    const firstId = plan && firstLesson(plan)?.id;
    const lesson = seed.lessons.find((l) => l.id === firstId) ?? seed.lessons[0];
    if (!lesson) return { kind: "waiting" };
    const view: QuizView = {
      quizzes: seed.quizzes.filter((q) => q.lesson_id === lesson.id),
      attempts: seed.attempts.filter((a) => a.lesson_id === lesson.id),
      mastery: seed.mastery.find((m) => m.lesson_id === lesson.id),
    };
    const quiz = view.quizzes.at(-1);
    const attempt = quiz && view.attempts.findLast((a) => a.quiz_id === quiz.id);
    if (!quiz || !attempt) return { kind: "waiting" };
    const course = courseOf(plan, lesson, seed.glossary, view);
    return { kind: "result", sample: true, quiz, attempt, ...course };
  }
  const plan = planFor(store, DEMO_SESSION_ID, learner)?.versions.at(-1);
  const lessonId = plan && firstLesson(plan)?.id;
  const written = plan && savedLessons(store, DEMO_SESSION_ID, plan);
  const lesson = lessonId && written?.lessons[lessonId];
  if (!plan || !written || !lesson) return { kind: "waiting" };
  const view = quizView(savedQuizzes(store, DEMO_SESSION_ID, plan.id), lesson.id);
  const course = courseOf(plan, lesson, written.glossary, view);
  const quiz = view.quizzes.at(-1);
  if (!quiz) return { kind: "writing", ...course };
  const attempt = view.attempts.find((a) => a.quiz_id === quiz.id);
  return attempt
    ? { kind: "result", sample: false, quiz, attempt, ...course }
    : { kind: "answering", quiz, ...course };
}

function scoreLabel(score: number): string {
  if (score >= 1) return "درجة كاملة";
  if (score === 0.5) return "نصف درجة";
  if (score <= 0) return "لا درجة";
  return `${percent(score)} من الدرجة`;
}

const itemName = (index: number) => `السؤال ${arabicNumber(index + 1)}`;

// Where the lesson explains what an item checks: the sections that use its glossary terms, and the
// terms in the glossary under the lesson.
function ReviewLinks({ item, course }: { item: Item; course: Course }) {
  const terms = course.glossary.filter((e) => item.glossary_ids.includes(e.id));
  const sections = course.lesson.sections.flatMap((s, i) =>
    termMarks(s.arabic, terms).length ? [i] : [],
  );
  if (!sections.length && !terms.length) return null;
  return (
    <p className={styles.revLinks}>
      <span>راجع</span>
      {sections.map((i) => (
        <Link key={i} className={styles.revLink} href={`/lesson#section-${i + 1}`}>
          <BookOpen aria-hidden />
          القسم {ordinal(i)} من الدرس
        </Link>
      ))}
      {terms.map((e) => (
        <Link key={e.id} className={styles.revLink} href={`/lesson#glossary-${e.id}`}>
          <BookA aria-hidden />
          <span>
            {e.ar} (<bdi lang={e.src.lang}>{e.src.term}</bdi>)
            <span className="sr-only"> في المصطلحات</span>
          </span>
        </Link>
      ))}
    </p>
  );
}

function ReviewCard({
  item,
  index,
  graded,
  course,
}: {
  item: Item;
  index: number;
  graded: Graded;
  course: Course;
}) {
  const full = graded.score >= 1;
  return (
    <li>
      <article className={cx(styles.q, styles.reviewed)} id={`q-${item.id}`}>
        <h3 className={styles.qHead}>
          <span className={styles.qNum} aria-hidden>
            {arabicNumber(index + 1)}
          </span>
          <span className={styles.qPrompt}>
            <span className="sr-only">{itemName(index)}: </span>
            <BidiText text={item.prompt_ar} />
          </span>
        </h3>
        <div className={styles.qMeta}>
          <StatusPill status={full ? "ready" : "attention"}>{scoreLabel(graded.score)}</StatusPill>
        </div>
        <div className={styles.qBody}>
          {item.type === "mcq" ? (
            <ul className={styles.opts}>
              {item.options_ar.map((option) => {
                const correct = option === item.answer;
                const chosen = option === graded.response;
                return (
                  <li
                    key={option}
                    className={cx(
                      styles.opt,
                      correct && styles.correct,
                      chosen && styles.chosen,
                      chosen && !correct && styles.wrong,
                    )}
                  >
                    <span className={styles.optMark} aria-hidden />
                    <span className={styles.optText}>
                      <BidiText text={option} />
                    </span>
                    {(chosen || correct) && (
                      <span className={styles.optTag}>
                        {correct ? <Check aria-hidden /> : <X aria-hidden />}
                        {chosen ? "إجابتك" : "الإجابة الصحيحة"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.resp}>
              <span className={styles.respLabel}>إجابتك</span>
              <p className={styles.respText} dir="rtl">
                <BidiText text={graded.response} />
              </p>
            </div>
          )}
          <div className={styles.feedback}>
            <Callout icon={full ? CircleCheck : Info} tone={full ? "ready" : "attention"}>
              <BidiText text={graded.feedback_ar} />
            </Callout>
          </div>
          {item.type === "short" && (
            <details className={styles.rubric}>
              <summary>معيار التصحيح</summary>
              <p>
                <BidiText text={item.rubric_ar} />
              </p>
            </details>
          )}
          {!full && <ReviewLinks item={item} course={course} />}
        </div>
      </article>
    </li>
  );
}

// The score against the gate, filled from the right.
function ScoreBar({ score, gate }: { score: number; gate: number }) {
  return (
    <div
      className={styles.score}
      role="img"
      aria-label={`نتيجتك ${percent(score)}، والنجاح عند ${percent(gate)}`}
    >
      <div className={styles.scoreTrack}>
        <span className={styles.scoreFill} style={{ inlineSize: `${score * 100}%` }} />
        <span className={styles.scoreGate} style={{ insetInlineStart: `${gate * 100}%` }} />
      </div>
      <span className={styles.gateLabel} style={{ insetInlineStart: `${gate * 100}%` }} aria-hidden>
        النجاح عند {percent(gate)}
      </span>
    </div>
  );
}

function Result({ shown }: { shown: Extract<Shown, { kind: "result" }> }) {
  const { quiz, attempt, sample, next } = shown;
  const graded = quiz.items.flatMap((item, index) => {
    const answer = attempt.answers.find((a) => a.item_id === item.id);
    return answer ? [{ item, index, answer }] : [];
  });
  const missed = graded.filter((g) => g.answer.score < 1);
  const total = attempt.answers.reduce((sum, a) => sum + a.score, 0);
  const gate = percent(quiz.pass_threshold);
  const nextName = next && <BidiText text={`الدرس ${ordinal(next.position)}: ${next.title}`} />;
  return (
    <>
      <section
        className={cx(styles.result, attempt.passed ? styles.passed : styles.below)}
        aria-labelledby={RESULT_ID}
      >
        <h2 className={styles.resultTitle} id={RESULT_ID} tabIndex={-1}>
          <span>{attempt.passed ? "اجتزت الاختبار" : "لم تجتز الاختبار بعد"}</span>
          <span className="sr-only">، نتيجتك </span>
          <span className={styles.pct}>{percent(attempt.score)}</span>
        </h2>
        {!sample && <FocusOnArrival quizId={quiz.id} />}
        <ScoreBar score={attempt.score} gate={quiz.pass_threshold} />
        <p className={styles.resultSum}>
          {`مجموع درجاتك ${arabicNumber(total)} من ${arabicNumber(quiz.items.length)}، والنجاح عند ${gate}.`}
          {attempt.passed && missed.length > 0 && " ملاحظة الممتحن على كل سؤال معه أدناه."}
        </p>

        {attempt.passed ? (
          <div className={styles.next}>
            <div className={styles.nextText}>
              <span className={styles.nextIcon}>
                <LockOpen aria-hidden />
              </span>
              {nextName ? (
                <p>
                  <b>{nextName}</b>
                  <span>فُتح لك الآن.</span>
                </p>
              ) : (
                <p>
                  <b>اجتزت آخر درس في خطتك حتى الآن</b>
                  <span>تجد ما بعده في خطتك.</span>
                </p>
              )}
            </div>
            <Link href="/plan" className={buttonClass("primary", "lg")}>
              اذهب إلى خطتك
              <DirIcon icon={ArrowRight} />
            </Link>
          </div>
        ) : (
          <>
            {nextName && (
              <div className={cx(styles.next, styles.locked)}>
                <div className={styles.nextText}>
                  <span className={styles.nextIcon}>
                    <Lock aria-hidden />
                  </span>
                  <p>
                    <b>{nextName}</b>
                    <span>يُفتح حين تجتاز هذا الاختبار.</span>
                  </p>
                </div>
              </div>
            )}
            {missed.length > 0 && (
              <section className={styles.missed} aria-labelledby="missed-title">
                <h3 className={styles.missedTitle} id="missed-title">
                  راجع ما فاتك
                </h3>
                <ul className={styles.missList}>
                  {missed.map(({ item, index, answer }) => (
                    <li key={item.id} className={styles.miss}>
                      <div className={styles.missHead}>
                        <a href={`#q-${item.id}`}>{itemName(index)}</a>
                        <StatusPill status="attention">{scoreLabel(answer.score)}</StatusPill>
                      </div>
                      <p className={styles.missPrompt}>
                        <BidiText text={item.prompt_ar} />
                      </p>
                      <ReviewLinks item={item} course={shown} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!sample && (
              <div className={styles.retry}>
                <p>
                  المحاولة التالية اختبار جديد بأسئلة أخرى من الدرس نفسه. راجع ما فاتك أولًا، ثم ابدأ
                  حين تكون جاهزًا.
                </p>
                <div className={styles.retryActions}>
                  <NewQuizButton />
                  <Link href="/lesson" className={buttonClass("secondary", "lg")}>
                    راجع الدرس
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="answers-title">
        <h2 className="sr-only" id="answers-title">
          إجاباتك وملاحظات الممتحن
        </h2>
        <ol className={styles.items}>
          {graded.map(({ item, index, answer }) => (
            <ReviewCard key={item.id} item={item} index={index} graded={answer} course={shown} />
          ))}
        </ol>
      </section>
    </>
  );
}

// The head's pill outside the examiner's writing.
function pillOf(shown: Exclude<Shown, { kind: "waiting" | "writing" }>): ReactNode {
  if (shown.kind === "answering") {
    return shown.view.attempts.length ? (
      <StatusPill status="attention">أعد المحاولة</StatusPill>
    ) : (
      <StatusPill status="waiting">لم تختبر بعد</StatusPill>
    );
  }
  if (shown.sample) return <StatusPill status="neutral">مثال</StatusPill>;
  return shown.attempt.passed ? (
    <StatusPill status="ready">اجتزته</StatusPill>
  ) : (
    <StatusPill status="attention">أعد المحاولة</StatusPill>
  );
}

export default async function QuizPage() {
  await connection();
  const shown = shownQuiz();

  if (shown.kind === "waiting") {
    return (
      <Page width="reading">
        <PageHead title="الاختبار" pill={<StatusPill status="waiting">لم يُكتب بعد</StatusPill>} />
        <EmptyState
          icon={ClipboardCheck}
          text="يكتب الممتحن اختبار كل درس من الدرس نفسه، ويبدأ حين يجهز درسك الأول."
          actions={
            <Link href="/lesson" className={buttonClass("secondary")}>
              إلى الدرس
              <DirIcon icon={ArrowRight} />
            </Link>
          }
        />
      </Page>
    );
  }

  const { plan, lesson, view } = shown;
  const quiz = shown.kind === "writing" ? undefined : shown.quiz;
  const gate = quiz?.pass_threshold ?? PASS_THRESHOLD;
  const tries = view.mastery?.attempts ?? view.attempts.length;
  const best = view.mastery?.best_score ?? Math.max(0, ...view.attempts.map((a) => a.score));
  const lede =
    shown.kind === "result" && shown.sample ? (
      <>
        <b>هذا اختبار مثال.</b> أكمل <Link href="/intake">المقابلة</Link> لنكتب دروسك أنت
        واختباراتها.
      </>
    ) : view.mastery?.passed ? (
      "اجتزت اختبار هذا الدرس، وفُتح لك الدرس التالي."
    ) : (
      "الاختبار من الدرس نفسه، ويفتح لك الدرس التالي حين تجتازه."
    );

  return (
    <QuizWriter
      key={`${plan?.id}-${lesson.id}`}
      sessionId={DEMO_SESSION_ID}
      lessonId={lesson.id}
      quizId={view.quizzes.at(-1)?.id}
      build={shown.kind === "writing"}
    >
      <Page width="reading">
        <PageHead
          titleId={TITLE_ID}
          title={`اختبار الدرس ${ordinal(shown.position)}`}
          pill={
            <WhileWriting writing={<WritingPill />}>
              {shown.kind !== "writing" && pillOf(shown)}
            </WhileWriting>
          }
          lede={<WhileWriting writing={<WritingLede />}>{lede}</WhileWriting>}
          meta={
            <>
              <MetaItem icon={BookOpen}>
                <BidiText text={lesson.title_ar} />
              </MetaItem>
              {quiz && (
                <MetaItem icon={ClipboardCheck}>{countOf(quiz.items.length, QUESTIONS)}</MetaItem>
              )}
              <MetaItem icon={Target}>النجاح عند {percent(gate)}</MetaItem>
              {tries > 0 && <MetaItem icon={Gauge}>أفضل نتيجة {percent(best)}</MetaItem>}
              {tries > 0 && <MetaItem icon={RotateCcw}>{countOf(tries, ATTEMPTS)}</MetaItem>}
            </>
          }
        />
        <WritingDone />
        {shown.kind === "writing" && <WritingBody />}
        {shown.kind === "answering" && (
          <QuizPaper
            key={shown.quiz.id}
            quiz={withoutKeys(shown.quiz)}
            sessionId={DEMO_SESSION_ID}
            lessonId={lesson.id}
            note={
              tries > 0
                ? `اختبار جديد بأسئلة أخرى من الدرس نفسه، وهذه محاولتك ${ordinalF(tries)}. أفضل نتيجة لك حتى الآن ${percent(best)}، والنجاح عند ${percent(gate)}.`
                : undefined
            }
          />
        )}
        {shown.kind === "result" && (
          <WhileWriting writing={<WritingBody />}>
            <Result shown={shown} />
          </WhileWriting>
        )}
      </Page>
    </QuizWriter>
  );
}
