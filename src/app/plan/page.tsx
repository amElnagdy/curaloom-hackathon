// The plan (#15), layout C: a course document built from Omar's seed (title, properties, the outline
// as disclosure rows per module, the course's sources) beside the live «ما يحدث الآن» column.

import {
  ArrowRight,
  BookOpen,
  Calendar,
  CircleCheck,
  CircleDashed,
  ClipboardCheck,
  Clock,
  Languages,
  Lock,
  type LucideIcon,
  MessageSquare,
  Target,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Resource } from "../../../contracts/index.ts";
import { loadOmarSeed, type Seed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import { ActivityFeed, LiveStatusPill } from "../_shell/activity-feed.tsx";
import {
  COACH_STATUS,
  COACH_TITLE,
  courseStatus,
  inModule,
  latestPlan,
  moduleLessons,
  modulesOf,
  quizState,
  sessionsOf,
  simDay,
} from "../_shell/course.ts";
import { DisclosureGroup, DisclosureRow, FoldAllButton } from "../_shell/disclosure.tsx";
import {
  arabicNumber,
  countOf,
  HOURS,
  MINUTES,
  MODULES,
  ordinal,
  ordinalF,
  percent,
  QUESTIONS,
  SOURCES,
  WEEKS,
} from "../_shell/format.ts";
import {
  BidiText,
  buttonClass,
  DirIcon,
  ItemRow,
  LangBadge,
  Meta,
  RowGroup,
  SourceRow,
  StatusPill,
} from "../_shell/ui.tsx";
import styles from "./plan.module.css";

export const metadata: Metadata = { title: "الخطة" };

const LANG_COUNT = ["", "بلغة واحدة", "بلغتين", "بثلاث لغات", "بأربع لغات"];

const unique = <T,>(values: T[]) => [...new Set(values)];

type Row = { day: number; key: string; node: ReactNode };

// The latest plan version, split into modules by week: a module owns the committed sessions and
// coach events that fall in its weeks, and the lessons, quizzes and sources those sessions use.
function outlineOf(seed: Seed) {
  const plan = latestPlan(seed);
  const sessions = plan ? sessionsOf(plan) : [];
  const lessonIndex = (id: string) => seed.lessons.findIndex((l) => l.id === id);

  const modules = (plan ? modulesOf(plan) : []).map((module) => {
    const lessons = plan ? moduleLessons(seed, plan, module) : [];
    const own = sessions.filter((s) => inModule(module, s.day));
    const resourceIds = unique(own.flatMap((s) => s.resource_ids));
    return {
      ...module,
      id: `module-${module.index + 1}`,
      sessions: own,
      coach: seed.coach_events.filter((c) => inModule(module, c.sim_day)),
      lessons,
      quizzes: lessons.flatMap((l) => quizState(seed, l.id) ?? []),
      resources: seed.resources.filter((r) => resourceIds.includes(r.id)),
    };
  });
  return { sessions, modules, lessonIndex };
}

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
      <dt>
        <Icon aria-hidden />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function PlanPage() {
  const seed = loadOmarSeed(config.demoTopic);
  const { profile } = seed;
  const { sessions, modules, lessonIndex } = outlineOf(seed);
  const course = courseStatus(seed);
  const accepted = seed.resources.filter((r) => r.licence.verified);
  const rejected = seed.resources.length - accepted.length;
  const langs = unique(accepted.map((r) => r.lang));
  const totalWeeks = modules.reduce((sum, m) => sum + m.weeks, 0);
  const first = sessions[0];
  const firstLesson = first && seed.lessons.find((l) => l.id === first.lesson_id);
  const minutesOf = (lessonId: string) => sessions.find((s) => s.lesson_id === lessonId)?.minutes;

  const lessonRows = (m: (typeof modules)[number]) => [
    ...m.lessons.map((lesson) => {
      const minutes = minutesOf(lesson.id);
      return (
        <li key={lesson.id}>
          <ItemRow
            icon={BookOpen}
            title={lesson.title_ar}
            href="/lesson"
            meta={minutes ? countOf(minutes, MINUTES) : undefined}
            trail={
              <StatusPill status="ready" quiet>
                جاهز
              </StatusPill>
            }
          />
        </li>
      );
    }),
    ...m.quizzes.map((state) => {
      const { quiz } = state;
      const parts = [countOf(quiz.items.length, QUESTIONS), `النجاح عند ${percent(state.gate)}`];
      if (state.best !== undefined) parts.push(`أفضل نتيجة ${percent(state.best)}`);
      return (
        <li key={quiz.id}>
          <ItemRow
            icon={ClipboardCheck}
            title={`اختبار الدرس ${ordinal(lessonIndex(quiz.lesson_id))}`}
            href="/quiz"
            meta={<Meta parts={parts} />}
            trail={
              <StatusPill status={state.status} quiet>
                {state.label}
              </StatusPill>
            }
          />
        </li>
      );
    }),
  ];

  const scheduleRows = (m: (typeof modules)[number]) => {
    const rows: Row[] = [
      ...m.sessions.map((s) => ({
        day: s.day,
        key: s.id,
        node: (
          <ItemRow
            icon={Calendar}
            title={`الجلسة ${ordinalF(sessions.indexOf(s))}`}
            meta={
              <Meta
                parts={[
                  simDay(s.day),
                  countOf(s.minutes, MINUTES),
                  `الدرس ${ordinal(lessonIndex(s.lesson_id))}`,
                ]}
              />
            }
            trail={
              <StatusPill status="waiting" quiet>
                مجدولة
              </StatusPill>
            }
          />
        ),
      })),
      ...m.coach.map((c) => {
        const { status, label } = COACH_STATUS[c.status];
        return {
          day: c.sim_day,
          key: c.id,
          node: (
            <ItemRow
              icon={MessageSquare}
              title={COACH_TITLE[c.type]}
              href="/coach"
              meta={simDay(c.sim_day)}
              trail={
                <StatusPill status={status} quiet>
                  {label}
                </StatusPill>
              }
            />
          ),
        };
      }),
    ];
    return rows.sort((a, b) => a.day - b.day).map((r) => <li key={r.key}>{r.node}</li>);
  };

  const sourceRows = (resources: Resource[]) =>
    resources.map((r) => (
      <li key={r.id}>
        <SourceRow resource={r} />
      </li>
    ));

  return (
    <div className={styles.plan}>
      <article className={styles.doc} aria-labelledby="plan-title">
        <div className={styles.docInner}>
          <header>
            <h1 className={styles.title} id="plan-title">
              دورتك: <BidiText text={profile.goal} />
            </h1>
            <p className={styles.lede}>
              <b>
                {course.label} يا {profile.name}.
              </b>{" "}
              مدة الدورة {countOf(totalWeeks, WEEKS)}، وفيها {countOf(modules.length, MODULES)}،
              ومصادرها مفتوحة الترخيص {LANG_COUNT[langs.length]}.
              {first && <> جلستك الأولى {countOf(first.minutes, MINUTES)}.</>}
            </p>
            <dl className={styles.props}>
              <Prop icon={Target} label="الهدف">
                <BidiText text={profile.goal} />
              </Prop>
              <Prop icon={Clock} label="وقتك">
                {countOf(profile.hours_per_week, HOURS)} في الأسبوع
              </Prop>
              <Prop icon={Languages} label="لغات المصادر">
                {langs.map((lang) => (
                  <LangBadge key={lang} lang={lang} />
                ))}
              </Prop>
              <Prop icon={CircleDashed} label="الحالة">
                <LiveStatusPill status={course.status} label={course.label} />
              </Prop>
            </dl>
          </header>

          <section className={styles.section} aria-labelledby="outline-title">
            <DisclosureGroup ids={modules.map((m) => m.id)}>
              <div className={styles.sectionHead}>
                <h2 id="outline-title">مخطط الدورة</h2>
                <Meta parts={[countOf(modules.length, MODULES), countOf(totalWeeks, WEEKS)]} />
                <FoldAllButton />
              </div>
              {modules.map((m) => {
                const ready = m.lessons.length > 0;
                return (
                  <DisclosureRow
                    key={m.id}
                    id={m.id}
                    title={m.title}
                    meta={
                      <Meta
                        parts={[`الوحدة ${arabicNumber(m.index + 1)}`, countOf(m.weeks, WEEKS)]}
                      />
                    }
                    status={
                      <StatusPill status={ready ? "ready" : "waiting"}>
                        {ready ? "جاهزة" : "في الانتظار"}
                      </StatusPill>
                    }
                  >
                    <div className={styles.groups}>
                      {ready ? (
                        <>
                          <RowGroup label="الدروس">{lessonRows(m)}</RowGroup>
                          <RowGroup label="الجلسات">{scheduleRows(m)}</RowGroup>
                          <RowGroup label="المصادر">{sourceRows(m.resources)}</RowGroup>
                        </>
                      ) : (
                        <ul>
                          <li>
                            <ItemRow
                              icon={CircleDashed}
                              title="لم تُكتب دروس هذه الوحدة ولم تُجدوَل جلساتها بعد."
                              muted
                            />
                          </li>
                        </ul>
                      )}
                    </div>
                  </DisclosureRow>
                );
              })}
            </DisclosureGroup>
          </section>

          <section className={styles.section} aria-labelledby="sources-title">
            <div className={styles.sectionHead}>
              <h2 id="sources-title">مصادر الدورة</h2>
              <Meta
                parts={[
                  countOf(seed.resources.length, SOURCES),
                  `قُبل ${arabicNumber(accepted.length)}`,
                  `رُفض ${arabicNumber(rejected)}`,
                ]}
              />
            </div>
            <p className={styles.sectionNote}>
              وجدها الكشّاف بلغات مختلفة، ولا يدخل مصدر في دورتك إلا إذا تحقّق الكود من ترخيصه.
            </p>
            <ul className={styles.sourceList}>{sourceRows(seed.resources)}</ul>
          </section>
        </div>
      </article>

      <ActivityFeed>
        <div className={styles.start}>
          {firstLesson ? (
            <>
              <Link
                href="/lesson"
                className={buttonClass("primary", "lg", { className: styles.startButton })}
              >
                ابدأ الجلسة الأولى
                <DirIcon icon={ArrowRight} />
              </Link>
              <p className={styles.startHint}>
                <CircleCheck aria-hidden />
                <Meta
                  parts={[
                    `الدرس ${ordinal(lessonIndex(firstLesson.id))} جاهز`,
                    countOf(first.minutes, MINUTES),
                  ]}
                />
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                className={buttonClass("primary", "lg", { className: styles.startButton })}
                disabled
              >
                ابدأ الجلسة الأولى
                <DirIcon icon={ArrowRight} />
              </button>
              <p className={styles.startHint} data-locked>
                <Lock aria-hidden />
                يُفتح حين يجهز الدرس الأول
              </p>
            </>
          )}
        </div>
      </ActivityFeed>
    </div>
  );
}
