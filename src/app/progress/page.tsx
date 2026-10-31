// Progress (#21): the learner's course on the session's data, or the seed's before the intake. Each
// lesson against the quiz gate, the committed weeks day by day from the sim clock, the glossary so
// far, and every plan version with why it exists and what it changed. It renders again on each
// graded quiz, saved plan or clock move.

import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  Check,
  History,
  Lightbulb,
  Lock,
  type LucideIcon,
  Target,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import type { CoursePlan, QuizAttempt } from "../../../contracts/index.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { PASS_THRESHOLD } from "../../server/agents/examiner/examiner.ts";
import { readSimNow } from "../../server/clock/clock.ts";
import { createFileStore } from "../../server/store/store.ts";
import { Callout, EmptyState, Page, PageHead } from "../_shell/blocks.tsx";
import { simDay } from "../_shell/course.ts";
import {
  ATTEMPTS,
  arabicNumber,
  CHANGES,
  countOf,
  LESSONS,
  MINUTES,
  ordinal,
  ordinalF,
  percent,
  SESSIONS,
  TERMS,
  VERSIONS,
  WEEKS,
} from "../_shell/format.ts";
import { type CourseLesson, currentLesson, learnerCourse } from "../_shell/lessons.ts";
import {
  changeLines,
  type DayMark,
  type PlanDay,
  planDays,
  REASON_TEXT,
  startDay,
} from "../_shell/plans.ts";
import { BidiText, buttonClass, DirIcon, Meta, Sep, StatusPill } from "../_shell/ui.tsx";
import styles from "./progress.module.css";
import { RefreshOnProgress } from "./refresh.tsx";

export const metadata: Metadata = { title: "التقدّم" };

const lessonName = (l: CourseLesson) => `الدرس ${ordinal(l.position)}`;

function Prop({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.prop}>
      <dt className={styles.propLabel}>
        <Icon aria-hidden />
        {label}
      </dt>
      <dd className={styles.propValue}>{children}</dd>
    </div>
  );
}

function Section({
  id,
  title,
  meta,
  children,
}: {
  id: string;
  title: string;
  meta: string[];
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id}>{title}</h2>
        <Meta parts={meta} />
      </div>
      {children}
    </section>
  );
}

// Best score against the pass mark: the fill is the score, the tick is the gate.
function ScoreBar({ best }: { best: number | undefined }) {
  const gate = PASS_THRESHOLD;
  const style = { "--score": `${(best ?? 0) * 100}%`, "--gate": `${gate * 100}%` } as CSSProperties;
  return (
    <div className={styles.score}>
      <p className={styles.scoreHead}>
        <span>
          {best === undefined ? (
            "لم تختبر بعد"
          ) : (
            <>
              أفضل نتيجة <b>{percent(best)}</b>
            </>
          )}
        </span>
        <span>النجاح عند {percent(gate)}</span>
      </p>
      <div
        className={styles.track}
        style={style}
        role="img"
        aria-label={
          best === undefined
            ? `لم تختبر بعد، والنجاح عند ${percent(gate)}`
            : `أفضل نتيجة ${percent(best)}، والنجاح عند ${percent(gate)}`
        }
      >
        {best !== undefined && (
          <span className={styles.fill} data-passed={best >= gate || undefined} />
        )}
        <span className={styles.tick} />
      </div>
    </div>
  );
}

// The attempts behind a lesson's state: the one that passed, or how many so far.
function attemptsText(lesson: CourseLesson, attempts: QuizAttempt[]): string[] {
  const passing = attempts.findIndex((a) => a.passed);
  const pass = attempts[passing];
  if (lesson.passed && pass)
    return [`اجتزته في المحاولة ${ordinalF(passing)}`, simDay(pass.sim_day)];
  const last = attempts.at(-1);
  return last ? [countOf(attempts.length, ATTEMPTS), `آخرها في ${simDay(last.sim_day)}`] : [];
}

function LessonRow({
  lesson,
  current,
  attempts,
}: {
  lesson: CourseLesson;
  current: boolean;
  attempts: QuizAttempt[];
}) {
  const state = lesson.passed ? "passed" : lesson.open ? "open" : "locked";
  const title = <BidiText text={lesson.planned.title_ar} />;
  const detail = attemptsText(lesson, attempts);
  return (
    <li className={styles.lesson} data-state={state}>
      <span className={styles.num} aria-hidden>
        {lesson.passed ? <Check /> : lesson.open ? arabicNumber(lesson.position + 1) : <Lock />}
      </span>
      <div className={styles.lessonText}>
        <span className={styles.kick}>
          {lessonName(lesson)}
          {current && <span className={styles.badge}>درسك الآن</span>}
        </span>
        {lesson.open ? (
          <Link href={`/lesson/${lesson.planned.id}`} className={styles.lessonTitle}>
            {title}
          </Link>
        ) : (
          <span className={styles.lessonTitle}>{title}</span>
        )}
      </div>
      {lesson.open ? (
        <div className={styles.lessonScore}>
          <ScoreBar best={lesson.best} />
          {detail.length > 0 && <Meta parts={detail} className={styles.lessonMeta} />}
        </div>
      ) : (
        <p className={styles.lessonLocked}>
          <Lock aria-hidden />
          يُفتح حين تجتاز اختبار الدرس {ordinal(lesson.position - 1)}
        </p>
      )}
    </li>
  );
}

const DAY_TEXT: Record<DayMark, string> = {
  done: "أنجزت جلسته",
  missed: "فاتتك جلسته",
  due: "جلسته اليوم",
  upcoming: "جلسة قادمة",
  rest: "بلا جلسة",
};
const DAY_ICON: Partial<Record<DayMark, ReactNode>> = {
  done: <Check aria-hidden />,
  missed: <X aria-hidden />,
  due: <i className={styles.dot} aria-hidden />,
  upcoming: <i className={styles.dot} aria-hidden />,
};

// The committed weeks: a cell per day marked done, missed, due today, upcoming or free, each week
// with its minutes and the version that took over in it, if one did.
function Weeks({ days, versions }: { days: PlanDay[]; versions: CoursePlan[] }) {
  // A version whose commitment starts on a new day is a re-plan; a learner's edit keeps the start.
  const replans = versions.filter(
    (v, i) => i > 0 && startDay(v) !== startDay(versions[i - 1] ?? v),
  );
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, w) =>
    days.slice(w * 7, w * 7 + 7),
  );
  return (
    <div className={styles.weeks}>
      {weeks.map((week, w) => {
        const minutes = week.reduce((sum, d) => sum + d.minutes, 0);
        const from = replans.find((v) => week.some((d) => d.day === startDay(v)));
        return (
          <div key={ordinal(w)}>
            <p className={styles.weekHead}>
              <b>الأسبوع {ordinal(w)}</b>
              <Meta
                parts={[
                  countOf(minutes, MINUTES),
                  ...(from
                    ? [`النسخة ${arabicNumber(from.version)} من ${simDay(startDay(from))}`]
                    : []),
                ]}
              />
            </p>
            <ol className={styles.days}>
              {week.map((d) => (
                <li
                  key={d.day}
                  className={styles.day}
                  data-mark={d.mark}
                  data-today={d.today || undefined}
                  data-replan={(from && d.day === startDay(from)) || undefined}
                  aria-label={`${simDay(d.day)}${d.today ? "، اليوم" : ""}: ${DAY_TEXT[d.mark]}`}
                >
                  {DAY_ICON[d.mark]}
                  <span aria-hidden>{d.day === 0 ? "البدء" : arabicNumber(d.day)}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

const LEGEND: [DayMark | "today", string][] = [
  ["done", "أنجزتها"],
  ["missed", "فاتتك"],
  ["today", "اليوم"],
  ["upcoming", "قادمة"],
  ["rest", "بلا جلسة"],
];

// The plan's versions, oldest first: the first as the architect built it, each later one with its
// reason, what changed from the one before and the re-planner's explanation.
function PlanHistory({ versions }: { versions: CoursePlan[] }) {
  return (
    <ol className={styles.history}>
      {versions.map((v, i) => {
        const latest = i === versions.length - 1;
        const sessions = v.committed.sessions;
        const lines = changeLines(v);
        const meta =
          i === 0
            ? [
                `من ${simDay(startDay(v))}`,
                countOf(sessions.length, SESSIONS),
                countOf(
                  sessions.reduce((sum, s) => sum + s.minutes, 0),
                  MINUTES,
                ),
                countOf(v.committed.weeks, WEEKS),
              ]
            : [`من ${simDay(startDay(v))}`, countOf(v.diff.length, CHANGES)];
        return (
          <li key={v.version} className={styles.node} data-latest={latest || undefined}>
            <span className={styles.nodeNum} aria-hidden>
              {arabicNumber(v.version)}
            </span>
            <div className={styles.nodeBody}>
              <div className={styles.nodeHead}>
                <h3>النسخة {arabicNumber(v.version)}</h3>
                <span className={styles.reason}>{REASON_TEXT[v.reason]}</span>
                <Meta parts={meta} className={styles.nodeMeta} />
                {latest && versions.length > 1 && (
                  <StatusPill status="ready">خطتك الحالية</StatusPill>
                )}
              </div>
              {lines.length > 0 && (
                <ul className={styles.changes}>
                  {lines.map((line) => (
                    <li key={line}>
                      <BidiText text={line} />
                    </li>
                  ))}
                </ul>
              )}
              {v.explanation_ar && (
                <div className={styles.why}>
                  <Callout icon={Lightbulb} tone="accent">
                    <BidiText text={v.explanation_ar} />
                  </Callout>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default async function ProgressPage() {
  // The page reads the session store and the sim clock, so it renders on each request.
  await connection();
  const course = learnerCourse();
  if (!course) {
    return (
      <Page width="narrow">
        <PageHead title="تقدّمك" />
        <EmptyState
          icon={Target}
          title="لا تقدّم بعد"
          text="يبدأ تقدّمك حين تجهز خطتك: دروسها واختباراتها وأيامها."
          actions={
            <Link href="/plan" className={buttonClass("primary")}>
              إلى خطتك
              <DirIcon icon={ArrowRight} />
            </Link>
          }
        />
        <RefreshOnProgress />
      </Page>
    );
  }

  const today = readSimNow(createFileStore(), DEMO_SESSION_ID).day;
  const { states, versions, plan } = course;
  const passed = states.filter((l) => l.passed);
  const current = currentLesson(states);
  const days = planDays(versions, new Set(passed.map((l) => l.planned.id)), today);
  const marks = days.flatMap((d) => d.sessions);
  const done = marks.filter((m) => m === "done").length;
  const missed = marks.filter((m) => m === "missed").length;
  const attemptsOf = (lessonId: string) =>
    course.quizzes.attempts
      .filter((a) => a.lesson_id === lessonId)
      .sort((a, b) => a.sim_day - b.sim_day);
  // The glossary panel of the latest written lesson that has terms.
  const glossaryLesson = states.findLast(
    (l) => (course.lessons[l.planned.id]?.glossary_ids.length ?? 0) > 0,
  );

  const lede = course.sample ? (
    <>
      <b>هذا تقدّم مثال.</b> أكمل <Link href="/intake">المقابلة</Link> لنبني خطتك ونتابع تقدّمك أنت.
    </>
  ) : (
    [
      `أنت في ${simDay(today)} من دورتك.`,
      ...(missed > 0 ? [`فاتتك ${countOf(missed, SESSIONS)} من خطتك.`] : []),
      ...(plan.version > 1 ? [`خطتك الآن في نسختها ${ordinalF(plan.version - 1)}.`] : []),
    ].join(" ")
  );

  return (
    <Page width="narrow">
      <RefreshOnProgress />
      <PageHead
        title="تقدّمك"
        pill={
          course.sample ? (
            <StatusPill status="neutral">مثال</StatusPill>
          ) : passed.length > 0 ? (
            <StatusPill status="ready">
              اجتزت {arabicNumber(passed.length)} من {arabicNumber(states.length)}
            </StatusPill>
          ) : (
            <StatusPill status="waiting">لم تجتز درسًا بعد</StatusPill>
          )
        }
        lede={lede}
      />

      <dl className={styles.props}>
        <Prop icon={Target} label="درسك الآن">
          {!current ? (
            <span className={styles.muted}>لا دروس بعد</span>
          ) : current.passed ? (
            "اجتزت كل دروس خطتك"
          ) : (
            lessonName(current)
          )}
        </Prop>
        <Prop icon={CalendarCheck} label={`الجلسات حتى ${simDay(today)}`}>
          {done + missed === 0 ? (
            <span className={styles.muted}>لم يمض موعد جلسة بعد</span>
          ) : (
            <>
              <span className={styles.done}>أنجزت {arabicNumber(done)}</span>
              <Sep />
              <span className={styles.missed}>فاتتك {arabicNumber(missed)}</span>
            </>
          )}
        </Prop>
        <Prop icon={BookOpen} label="المصطلحات">
          {course.glossary.length === 0 ? (
            <span className={styles.muted}>تُجمع مع دروسك</span>
          ) : (
            <>
              {countOf(course.glossary.length, TERMS)}
              {glossaryLesson && (
                <Link
                  href={`/lesson/${glossaryLesson.planned.id}#glossary-title`}
                  className={styles.propLink}
                  aria-label={`راجع مصطلحات ${lessonName(glossaryLesson)}`}
                >
                  راجعها
                  <DirIcon icon={ArrowRight} />
                </Link>
              )}
            </>
          )}
        </Prop>
        <Prop icon={History} label="خطتك">
          النسخة {arabicNumber(plan.version)}
          {versions.length > 1 && (
            <a href="#history-title" className={styles.propLink}>
              ما الذي تغيّر
              <DirIcon icon={ArrowRight} />
            </a>
          )}
        </Prop>
      </dl>

      <Section
        id="lessons-title"
        title="دروسك"
        meta={[
          countOf(states.length, LESSONS),
          `يُفتح كل درس حين تجتاز اختبار الذي قبله بـ${percent(PASS_THRESHOLD)} أو أكثر`,
        ]}
      >
        <ol>
          {states.map((lesson) => (
            <LessonRow
              key={lesson.planned.id}
              lesson={lesson}
              current={lesson === current && !lesson.passed}
              attempts={attemptsOf(lesson.planned.id)}
            />
          ))}
        </ol>
      </Section>

      <Section
        id="adherence-title"
        title="التزامك بالخطة"
        meta={[`حتى ${simDay(today)}`, countOf(days.length / 7, WEEKS)]}
      >
        <Weeks days={days} versions={versions} />
        <ul className={styles.legend}>
          {LEGEND.map(([mark, label]) => (
            <li key={mark} data-mark={mark}>
              <i className={styles.swatch} aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="history-title"
        title="تاريخ خطتك"
        meta={[countOf(versions.length, VERSIONS), "كل تعديل نسخة جديدة، ولا تُمحى القديمة"]}
      >
        <PlanHistory versions={versions} />
      </Section>
    </Page>
  );
}
