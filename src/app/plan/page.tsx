// The plan (#18), layout B: why the plan has this shape, the two committed weeks as a strip of days,
// and the road as a timeline whose committed modules list their sessions for the learner to move or
// shorten, beside the live «ما يحدث الآن» column. Once the intake is done and there is no plan yet,
// the page builds one; before the intake it shows the seed's plan as an example.

import {
  ArrowRight,
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
import { createFileStore } from "../../server/store/store.ts";
import { ActivityFeed, LiveStatusPill } from "../_shell/activity-feed.tsx";
import { Callout } from "../_shell/blocks.tsx";
import { latestPlan, sessionsOf, simDay } from "../_shell/course.ts";
import {
  arabicNumber,
  countOf,
  HOURS,
  MINUTES,
  MODULES,
  ordinal,
  SESSIONS,
  SOURCES,
  WEEKS,
} from "../_shell/format.ts";
import {
  BidiText,
  buttonClass,
  DirIcon,
  LangBadge,
  Meta,
  SourceRow,
  StatusPill,
} from "../_shell/ui.tsx";
import styles from "./plan.module.css";
import { BuildPlan, Road } from "./road.tsx";

export const metadata: Metadata = { title: "الخطة" };

const LANG_COUNT = ["", "بلغة واحدة", "بلغتين", "بثلاث لغات", "بأربع لغات"];

const unique = <T,>(values: T[]) => [...new Set(values)];

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
  // Lessons are written after the plan (#19); until then only the example's first one exists.
  const first = sessions[0];
  const firstLesson =
    shown && !shown.editable && seed.lessons.find((l) => l.id === first?.lesson_id);

  return (
    <div className={styles.plan}>
      <article className={styles.doc} aria-labelledby="plan-title" aria-busy={!shown}>
        <div className={styles.docInner}>
          <header>
            <h1 className={styles.title} id="plan-title">
              دورتك: <BidiText text={profile.goal} />
            </h1>
            <p className={styles.lede}>
              {!shown ? (
                <>
                  <b>نبني خطتك الآن يا {profile.name}.</b> يبحث الكشّاف عن مصادر مفتوحة الترخيص، ثم
                  يقسّم المعماري الطريق على وقتك. قد يستغرق ذلك دقيقتين.
                </>
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
                  <StatusPill status="building">تُبنى الآن</StatusPill>
                ) : shown.editable ? (
                  <LiveStatusPill status="ready" label="الخطة جاهزة" />
                ) : (
                  <StatusPill status="neutral">مثال</StatusPill>
                )}
              </Prop>
            </dl>
          </header>

          {!shown || !plan ? (
            <>
              <BuildPlan sessionId={DEMO_SESSION_ID} />
              <div className={styles.skeleton} data-size="why" />
              <section className={styles.section} aria-label="أسبوعاك الأولان">
                <div className={styles.skeleton} data-size="strip" />
              </section>
              <section className={styles.section} aria-label="الطريق">
                <div className={styles.skeleton} data-size="road" />
              </section>
            </>
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

      <ActivityFeed>
        <div className={styles.start}>
          {firstLesson && first ? (
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
                <Meta parts={["الدرس الأول جاهز", countOf(first.minutes, MINUTES)]} />
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
