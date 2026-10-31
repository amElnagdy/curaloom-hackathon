// The quiz (#20) of a lesson of the learner's plan, by the lesson's id (#34). The
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
import type { GlossaryEntry, Lesson, Quiz, QuizAttempt } from "../../../../contracts/index.ts";
import { DEMO_SESSION_ID } from "../../../../demo/session.ts";
import { PASS_THRESHOLD, quizView } from "../../../server/agents/examiner/examiner.ts";
import { type QuizView, withoutKeys } from "../../../server/agents/examiner/rules.ts";
import { termMarks } from "../../../server/agents/lesson/rules.ts";
import { Callout, MetaItem, Page, PageHead } from "../../_shell/blocks.tsx";
import {
  ATTEMPTS,
  arabicNumber,
  countOf,
  ordinal,
  ordinalF,
  percent,
  QUESTIONS,
} from "../../_shell/format.ts";
import { type CourseLesson, learnerCourse } from "../../_shell/lessons.ts";
import { BidiText, buttonClass, cx, DirIcon, StatusPill } from "../../_shell/ui.tsx";
import { LockedBody, MissingLesson } from "../../lesson/states.tsx";
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
} from "../paper.tsx";
import styles from "../quiz.module.css";
import { QuizWaiting } from "../waiting.tsx";

export const metadata: Metadata = { title: "الاختبار" };

type Item = Quiz["items"][number];
type Graded = QuizAttempt["answers"][number];

// The lesson the quiz is on: its place in the plan, its glossary entries, its quizzes and attempts,
// and the lesson after it in the plan.
type Course = {
  planId: string;
  lesson: Lesson;
  position: number;
  glossary: GlossaryEntry[];
  view: QuizView;
  next: CourseLesson | undefined;
};

// What the page shows: nothing before the plan or the lesson is written, a lesson the plan lacks, a
// lesson the quiz gate keeps shut, the examiner writing the quiz, the quiz to take, or the latest
// quiz graded (the seed's, as a `sample`, before the intake).
type Shown =
  | { kind: "waiting"; lessonId: string | undefined }
  | { kind: "missing" }
  | { kind: "locked"; state: CourseLesson; lessons: CourseLesson[] }
  | ({ kind: "writing" } & Course)
  | ({ kind: "answering"; quiz: Quiz } & Course)
  | ({ kind: "result"; sample: boolean; quiz: Quiz; attempt: QuizAttempt } & Course);

function shownQuiz(lessonId: string): Shown {
  const course = learnerCourse();
  if (!course) return { kind: "waiting", lessonId: undefined };
  const state = course.states.find((s) => s.planned.id === lessonId);
  if (!state) return { kind: "missing" };
  if (!state.open) return { kind: "locked", state, lessons: course.states };
  const lesson = course.lessons[lessonId];
  if (!lesson) return { kind: "waiting", lessonId };
  const view = quizView(course.quizzes, lessonId);
  const shared: Course = {
    planId: course.plan.id,
    lesson,
    position: state.position,
    glossary: lesson.glossary_ids.flatMap((id) => course.glossary.filter((g) => g.id === id)),
    view,
    next: course.states[state.position + 1],
  };
  const quiz = view.quizzes.at(-1);
  const attempt = quiz && view.attempts.findLast((a) => a.quiz_id === quiz.id);
  if (course.sample) {
    return quiz && attempt
      ? { kind: "result", sample: true, quiz, attempt, ...shared }
      : { kind: "waiting", lessonId };
  }
  if (!quiz) return { kind: "writing", ...shared };
  return attempt
    ? { kind: "result", sample: false, quiz, attempt, ...shared }
    : { kind: "answering", quiz, ...shared };
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
        <Link
          key={i}
          className={styles.revLink}
          href={`/lesson/${course.lesson.id}#section-${i + 1}`}
        >
          <BookOpen aria-hidden />
          القسم {ordinal(i)} من الدرس
        </Link>
      ))}
      {terms.map((e) => (
        <Link
          key={e.id}
          className={styles.revLink}
          href={`/lesson/${course.lesson.id}#glossary-${e.id}`}
        >
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
  const nextName = next && (
    <BidiText text={`الدرس ${ordinal(next.position)}: ${next.planned.title_ar}`} />
  );
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
            {next ? (
              <div className={styles.nextActions}>
                <Link href={`/lesson/${next.planned.id}`} className={buttonClass("primary", "lg")}>
                  تابع إلى الدرس {ordinal(next.position)}
                  <DirIcon icon={ArrowRight} />
                </Link>
                <Link href="/plan" className={buttonClass("ghost", "lg")}>
                  إلى خطتك
                </Link>
              </div>
            ) : (
              <Link href="/plan" className={buttonClass("primary", "lg")}>
                اذهب إلى خطتك
                <DirIcon icon={ArrowRight} />
              </Link>
            )}
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
                  <Link
                    href={`/lesson/${shown.lesson.id}`}
                    className={buttonClass("secondary", "lg")}
                  >
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
function pillOf(shown: Extract<Shown, { kind: "answering" | "result" }>): ReactNode {
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

export default async function QuizPage({ params }: PageProps<"/quiz/[lessonId]">) {
  await connection();
  const { lessonId } = await params;
  const shown = shownQuiz(lessonId);

  if (shown.kind === "waiting") return <QuizWaiting lessonId={shown.lessonId} />;
  if (shown.kind === "missing") return <MissingLesson />;
  if (shown.kind === "locked") {
    return (
      <Page width="reading">
        <PageHead
          titleId={TITLE_ID}
          title={`اختبار الدرس ${ordinal(shown.state.position)}`}
          pill={<StatusPill status="neutral">مقفل</StatusPill>}
          meta={
            <MetaItem icon={BookOpen}>
              <BidiText text={shown.state.planned.title_ar} />
            </MetaItem>
          }
        />
        <LockedBody state={shown.state} lessons={shown.lessons} />
      </Page>
    );
  }

  const { planId, lesson, view } = shown;
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
      shown.next ? (
        "اجتزت اختبار هذا الدرس، وفُتح لك الدرس التالي."
      ) : (
        "اجتزت اختبار آخر درس في خطتك حتى الآن، وتجد ما بعده في خطتك."
      )
    ) : shown.next ? (
      "الاختبار من الدرس نفسه، ويفتح لك الدرس التالي حين تجتازه."
    ) : (
      "الاختبار من الدرس نفسه، وهو آخر اختبار في خطتك حتى الآن."
    );

  return (
    <QuizWriter
      key={`${planId}-${lesson.id}`}
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
