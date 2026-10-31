// The plan (#18), layout B: why the plan has this shape, the two committed weeks as a strip of days,
// and the road as a timeline whose committed modules list their sessions for the learner to move or
// shorten, beside the live «ما يحدث الآن» column. Once the intake is done and there is no plan yet,
// the page builds one; before the intake it shows the seed's plan as an example.

import {
  ArrowRight,
  BellRing,
  CircleCheck,
  CircleDashed,
  Clock,
  Languages,
  Lightbulb,
  Lock,
  type LucideIcon,
  Target,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type { CoursePlan, Resource } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { architectBrief, limitsOf, planFor } from "../../server/agents/architect/architect.ts";
import { type Limits, SESSION_MINUTES, weekMinutes } from "../../server/agents/architect/rules.ts";
import { savedProfile } from "../../server/agents/intake/intake.ts";
import { sessionSim } from "../../server/coach/session.ts";
import { contentHash, createFileStore } from "../../server/store/store.ts";
import { ActivityFeed, LiveStatusPill } from "../_shell/activity-feed.tsx";
import { Callout } from "../_shell/blocks.tsx";
import { latestPlan, sessionsOf, simDay, unique } from "../_shell/course.ts";
import {
  arabicNumber,
  countOf,
  HOURS,
  LESSONS,
  MINUTES,
  MODULES,
  ordinal,
  SESSIONS,
  SOURCES,
  WEEKS,
} from "../_shell/format.ts";
import { LessonStrip } from "../_shell/lesson-strip.tsx";
import { currentLesson, learnerCourse } from "../_shell/lessons.ts";
import {
  BidiText,
  buttonClass,
  DirIcon,
  LangBadge,
  Meta,
  SourceRow,
  StatusPill,
} from "../_shell/ui.tsx";
import { LessonBuilding, WritingHint } from "../lesson/terms.tsx";
import styles from "./plan.module.css";
import { Building, BuildingBody, BuildingLede, BuildingStatus, Road } from "./road.tsx";

export const metadata: Metadata = { title: "الخطة" };

const LANG_COUNT = ["", "بلغة واحدة", "بلغتين", "بثلاث لغات", "بأربع لغات"];

// The plan the page shows and what it must fit. Only the session's own plan takes edits.
type PlanOnPage = { plan: CoursePlan; resources: Resource[]; limits: Limits; editable: boolean };

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

// The committed weeks day by day: a bar per day as long as its sessions, and each week's minutes
// against the learner's time.
function WeekStrip({ plan, budget }: { plan: CoursePlan; budget: number }) {
  const used = weekMinutes(plan);
  return (
    <div className={styles.strip}>
      {used.map((minutes, week) => (
        <div key={ordinal(week)} className={styles.week}>
          <p className={styles.weekHead}>
            <b>الأسبوع {ordinal(week)}</b>
            <span>
              {arabicNumber(minutes)} من {arabicNumber(budget)} دقيقة من وقتك
            </span>
          </p>
          <ol className={styles.days}>
            {Array.from({ length: 7 }, (_, i) => {
              const day = week * 7 + i;
              const total = plan.committed.sessions
                .filter((s) => s.day === day)
                .reduce((sum, s) => sum + s.minutes, 0);
              return (
                <li
                  key={day}
                  className={styles.day}
                  data-has={total > 0}
                  aria-label={`${simDay(day)}: ${total ? countOf(total, MINUTES) : "بلا جلسة"}`}
                >
                  {total > 0 && (
                    <i
                      style={{ blockSize: `${Math.min(total / SESSION_MINUTES.max, 1) * 2.5}rem` }}
                      aria-hidden
                    />
                  )}
                  <span aria-hidden>{day === 0 ? "البدء" : arabicNumber(day)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export default async function PlanPage() {
  await connection();
  const store = createFileStore();
  const seed = loadOmarSeed(config.demoTopic);
  const learner = savedProfile(store, DEMO_SESSION_ID);
  const profile = learner ?? seed.profile;
  // Only a plan built for this learner's profile is theirs; any other waits for a rebuild.
  const saved = learner && planFor(store, DEMO_SESSION_ID, learner);
  const latest = saved?.versions.at(-1);
  const example = latestPlan(seed);

  let shown: PlanOnPage | undefined;
  if (saved && latest) {
    shown = { plan: latest, resources: saved.resources, limits: saved.limits, editable: true };
  } else if (!learner && example) {
    const limits = limitsOf(architectBrief(seed.profile, seed.resources));
    shown = { plan: example, resources: seed.resources, limits, editable: false };
  }

  const plan = shown?.plan;
  const sessions = plan ? sessionsOf(plan) : [];
  const resources = shown?.resources ?? [];
  const accepted = resources.filter((r) => r.licence.verified);
  const langs = unique(accepted.map((r) => r.lang));
  const totalWeeks = plan?.road.reduce((sum, m) => sum + m.weeks, 0) ?? 0;
  const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  // The lesson the learner is on opens from here, and is written here first if it is not yet: the
  // first once the plan is ready (#19), the next once the quiz gate opens it (#34).
  const course = shown && learnerCourse();
  const states = course && course.plan.id === plan?.id ? course.states : [];
  const current = currentLesson(states);
  const currentName = `الدرس ${ordinal(current?.position ?? 0)}`;
  const startLabel = `${current?.best === undefined ? "ابدأ" : "تابع"} ${currentName}`;
  const writeCurrent = !!(shown?.editable && current && !current.written);
  // Once the learner's own plan is ready, the coach asks for consent until they answer (#24).
  const consent = shown?.editable && sessionSim(store, DEMO_SESSION_ID, seed).sim.consent();
  const askConsent = !!consent && !consent.granted && !consent.opted_out;

  const article = (
    <article className={styles.doc} aria-labelledby="plan-title">
      <div className={styles.docInner}>
        <header>
          <h1 className={styles.title} id="plan-title" tabIndex={-1}>
            دورتك: <BidiText text={profile.goal} />
          </h1>
          <p className={styles.lede}>
            {!shown ? (
              <BuildingLede name={profile.name} />
            ) : shown.editable ? (
              <>
                <b>خطتك جاهزة يا {profile.name}.</b> الطريق {countOf(totalWeeks, WEEKS)} في{" "}
                {countOf(plan?.road.length ?? 0, MODULES)}، وتلتزم الآن بأول أسبوعين منه فقط:{" "}
                {countOf(sessions.length, SESSIONS)}.
              </>
            ) : (
              <>
                <b>هذه خطة مثال.</b> أكمل <Link href="/intake">المقابلة</Link> لنبني خطتك أنت على
                هدفك ووقتك.
              </>
            )}
          </p>
          <dl className={styles.props}>
            <Prop icon={Target} label="الهدف">
              <BidiText text={profile.goal} />
            </Prop>
            <Prop icon={Clock} label="وقتك">
              {countOf(profile.hours_per_week, HOURS)} في الأسبوع
            </Prop>
            <Prop icon={Languages} label="لغات المصادر">
              {langs.length ? (
                langs.map((lang) => <LangBadge key={lang} lang={lang} />)
              ) : (
                <span className={styles.pending}>بعد البحث</span>
              )}
            </Prop>
            <Prop icon={CircleDashed} label="الحالة">
              {!shown ? (
                <BuildingStatus />
              ) : shown.editable ? (
                <LiveStatusPill status="ready" label="الخطة جاهزة" />
              ) : (
                <StatusPill status="neutral">مثال</StatusPill>
              )}
            </Prop>
          </dl>
        </header>

        {!shown || !plan ? (
          <BuildingBody />
        ) : (
          <>
            <div className={styles.why}>
              <Callout icon={Lightbulb} tone="accent">
                <b>لماذا هكذا؟</b> <BidiText text={plan.rationale_ar} />
              </Callout>
            </div>

            <section className={styles.section} aria-labelledby="weeks-title">
              <div className={styles.sectionHead}>
                <h2 id="weeks-title">أسبوعاك الأولان</h2>
                <Meta
                  parts={[countOf(sessions.length, SESSIONS), countOf(totalMinutes, MINUTES)]}
                />
              </div>
              <WeekStrip plan={plan} budget={shown.limits.budget_minutes} />
            </section>

            {states.length > 0 && (
              <section className={styles.section} aria-labelledby="lessons-title">
                <div className={styles.sectionHead}>
                  <h2 id="lessons-title">دروسك</h2>
                  <Meta
                    parts={[
                      countOf(states.length, LESSONS),
                      `اجتزت ${arabicNumber(states.filter((l) => l.passed).length)} من ${arabicNumber(states.length)}`,
                    ]}
                  />
                </div>
                <LessonStrip lessons={states} labelledBy="lessons-title" />
              </section>
            )}

            <section className={styles.section} aria-labelledby="road-title">
              <div className={styles.sectionHead}>
                <h2 id="road-title">الطريق</h2>
                <Meta parts={[countOf(plan.road.length, MODULES), countOf(totalWeeks, WEEKS)]} />
              </div>
              <Road
                key={`${plan.id}-${plan.version}`}
                sessionId={DEMO_SESSION_ID}
                plan={plan}
                limits={shown.limits}
                sources={Object.fromEntries(
                  resources.map((r) => [r.id, { lang: r.lang, title: r.title }]),
                )}
                editable={shown.editable}
                openLessons={states.filter((l) => l.open).map((l) => l.planned.id)}
              />
            </section>

            <section className={styles.section} aria-labelledby="sources-title">
              <div className={styles.sectionHead}>
                <h2 id="sources-title">مصادر الدورة</h2>
                <Meta
                  parts={[
                    countOf(resources.length, SOURCES),
                    `قُبل ${arabicNumber(accepted.length)}`,
                    `رُفض ${arabicNumber(resources.length - accepted.length)}`,
                  ]}
                />
              </div>
              <p className={styles.sectionNote}>
                وجدها الكشّاف {LANG_COUNT[langs.length] ?? "بلغات مختلفة"}، ولا يدخل مصدر في دورتك
                إلا إذا تحقّق الكود من ترخيصه.
              </p>
              <ul className={styles.sourceList}>
                {resources.map((r) => (
                  <li key={r.id}>
                    <SourceRow resource={r} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </article>
  );

  return (
    <div className={styles.plan}>
      {/* Keyed by the profile, so a page refreshed after the profile changed builds for the new one. */}
      <Building key={contentHash(profile)} sessionId={DEMO_SESSION_ID} build={!shown}>
        {article}
      </Building>

      <ActivityFeed>
        <div className={styles.start}>
          {current && (
            <p className={styles.startNext}>
              <small>{current.best === undefined ? "درسك التالي" : "درسك الآن"}</small>
              <b>
                <BidiText text={current.planned.title_ar} />
              </b>
            </p>
          )}
          {current?.written ? (
            <>
              <Link
                href={`/lesson/${current.planned.id}`}
                className={buttonClass("primary", "lg", { className: styles.startButton })}
              >
                {startLabel}
                <DirIcon icon={ArrowRight} />
              </Link>
              <p className={styles.startHint}>
                <CircleCheck aria-hidden />
                <Meta
                  parts={[
                    `${currentName} جاهز`,
                    ...(current.session ? [countOf(current.session.minutes, MINUTES)] : []),
                  ]}
                />
              </p>
            </>
          ) : (
            <LessonBuilding
              key={`${plan?.id}-${current?.planned.id}`}
              sessionId={DEMO_SESSION_ID}
              lessonId={current?.planned.id ?? ""}
              build={writeCurrent}
            >
              <button
                type="button"
                className={buttonClass("primary", "lg", { className: styles.startButton })}
                disabled
              >
                {startLabel}
                <DirIcon icon={ArrowRight} />
              </button>
              {writeCurrent ? (
                <WritingHint className={styles.startHint} titleId="plan-title" name={currentName} />
              ) : (
                <p className={styles.startHint} data-locked>
                  <Lock aria-hidden />
                  يُفتح حين يجهز {currentName}
                </p>
              )}
            </LessonBuilding>
          )}
          {askConsent && (
            <Link href="/consent" className={styles.coachAsk}>
              <BellRing aria-hidden />
              <span>
                <b>فعّل متابعة المدرب</b>
                <small>رسائل قصيرة حين تغيب عن جلساتك، ضمن حدود تضعها أنت.</small>
              </span>
              <DirIcon icon={ArrowRight} />
            </Link>
          )}
        </div>
      </ActivityFeed>
    </div>
  );
}
