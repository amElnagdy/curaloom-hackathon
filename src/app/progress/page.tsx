// Progress (#15 slot; the progress view is #21): an honest early state from Omar's mastery and
// quiz attempts. Nothing is passed yet; the page says so and shows how close the first lesson is.

import { Calendar, Check, ClipboardCheck, RotateCcw, Target } from "lucide-react";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import type { Lesson } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import {
  Callout,
  Columns,
  EmptyState,
  MarkItem,
  MarkList,
  Page,
  PageHead,
  Panel,
  Stack,
} from "../_shell/blocks.tsx";
import {
  latestPlan,
  moduleLessons,
  modulesOf,
  quizState,
  type Shown,
  sessionsOf,
  simDay,
} from "../_shell/course.ts";
import {
  ATTEMPTS,
  arabicNumber,
  countOf,
  HOURS,
  MINUTES,
  MODULES,
  ordinal,
  ordinalF,
  percent,
  WEEKS,
} from "../_shell/format.ts";
import { BidiText, Meta, StatusPill } from "../_shell/ui.tsx";
import styles from "./progress.module.css";

export const metadata: Metadata = { title: "التقدّم" };

const DEFAULT_GATE = 0.8;

// Best score against the pass mark: the fill is the score, the tick is the gate.
function ScoreBar({ score, gate }: { score: number; gate: number }) {
  const style = { "--score": `${score * 100}%`, "--gate": `${gate * 100}%` } as CSSProperties;
  return (
    <div className={styles.score}>
      <div className={styles.scoreHead}>
        <span>
          أفضل نتيجة <b>{percent(score)}</b>
        </span>
        <span>النجاح عند {percent(gate)}</span>
      </div>
      <div
        className={styles.track}
        style={style}
        role="img"
        aria-label={`أفضل نتيجة ${percent(score)}، والنجاح عند ${percent(gate)}`}
      >
        <span className={styles.fill} data-passed={score >= gate || undefined} />
        <span className={styles.tick} />
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const seed = loadOmarSeed(config.demoTopic);
  const plan = latestPlan(seed);
  const modules = plan ? modulesOf(plan) : [];
  const sessions = plan ? sessionsOf(plan) : [];
  const totalWeeks = modules.reduce((sum, m) => sum + m.weeks, 0);
  const lessonName = (lesson: Lesson) => `الدرس ${ordinal(seed.lessons.indexOf(lesson))}`;
  // Each lesson's quiz, in the state the plan and the quiz page show too.
  const quizzes = seed.lessons.flatMap((lesson) => {
    const state = quizState(seed, lesson.id);
    return state ? [{ lesson, state }] : [];
  });

  const passed = quizzes.filter((q) => q.state.passed).length;
  const closest = quizzes
    .filter((q) => q.state.status === "attention")
    .sort((a, b) => (b.state.best ?? 0) - (a.state.best ?? 0))[0];
  const attempts = [...seed.attempts].sort((a, b) => a.sim_day - b.sim_day);

  const weekOne = sessions.filter((s) => s.day < 7);
  const weekMinutes = weekOne.reduce((sum, s) => sum + s.minutes, 0);

  let lede = "تبدأ من الجلسة الأولى، وكل درس يُفتح بعد اجتياز الذي قبله.";
  if (passed === 0 && closest) {
    lede = `لم تجتز أي درس بعد، وهذا طبيعي في البداية. أقرب خطوة: ${lessonName(closest.lesson)}، أفضل نتيجة فيه ${percent(closest.state.best ?? 0)} وتحتاج ${percent(closest.state.gate)}.`;
  } else if (passed === 0) {
    lede = `لم تجتز أي درس بعد، وهذا طبيعي في البداية. ${lede}`;
  } else {
    lede = `اجتزت ${arabicNumber(passed)} من ${arabicNumber(seed.lessons.length)} من الدروس المكتوبة. ${lede}`;
  }

  return (
    <Page>
      <PageHead
        title="تقدّمك"
        pill={
          passed === 0 ? (
            <StatusPill status="waiting">لم تجتز درسًا بعد</StatusPill>
          ) : (
            <StatusPill status="ready">اجتزت {arabicNumber(passed)}</StatusPill>
          )
        }
        lede={lede}
      />

      <Columns>
        <Stack>
          <Panel
            id="path-title"
            title="مسار الدورة"
            sub={<Meta parts={[countOf(modules.length, MODULES), countOf(totalWeeks, WEEKS)]} />}
          >
            <MarkList>
              {modules.map((module) => {
                const lessons = plan ? moduleLessons(seed, plan, module) : [];
                const open = lessons.find((l) => !quizState(seed, l.id)?.passed);
                const state: Shown =
                  lessons.length === 0
                    ? { status: "waiting", label: "لم تبدأ" }
                    : !open
                      ? { status: "ready", label: "اجتزتها" }
                      : (quizState(seed, open.id) ?? {
                          status: "waiting",
                          label: "لم يُكتب اختباره بعد",
                        });
                const tone =
                  state.status === "ready"
                    ? "ready"
                    : state.status === "attention"
                      ? "attention"
                      : "neutral";
                return (
                  <MarkItem
                    key={module.index}
                    tone={tone}
                    mark={state.status === "ready" ? <Check /> : arabicNumber(module.index + 1)}
                    title={module.title}
                    detail={
                      lessons.length > 0 ? (
                        lessons.map((lesson) => (
                          <span key={lesson.id} className={styles.lessonLine}>
                            {lessonName(lesson)}: <BidiText text={lesson.title_ar} />
                          </span>
                        ))
                      ) : (
                        <Meta parts={["لم تُكتب دروسها بعد", countOf(module.weeks, WEEKS)]} />
                      )
                    }
                    value={<StatusPill status={state.status}>{state.label}</StatusPill>}
                  />
                );
              })}
            </MarkList>
            <div className={styles.rule}>
              <Callout icon={Target}>
                تنتقل إلى الدرس التالي حين تحصل على {percent(DEFAULT_GATE)} أو أكثر في اختبار الدرس.
                وإن تأخرت، يقترح المدرب خطة أخف بدل التذكير المتكرر.
              </Callout>
            </div>
          </Panel>
        </Stack>

        <Stack>
          <Panel
            id="attempts-title"
            title="المحاولات"
            sub={attempts.length > 0 ? countOf(attempts.length, ATTEMPTS) : undefined}
          >
            {attempts.length === 0 ? (
              <EmptyState
                inline
                icon={ClipboardCheck}
                text="لا محاولات بعد. أول اختبار بعد الدرس الأول."
              />
            ) : (
              <>
                {closest && <ScoreBar score={closest.state.best ?? 0} gate={closest.state.gate} />}
                <MarkList>
                  {attempts.map((attempt) => {
                    const lesson = seed.lessons.find((l) => l.id === attempt.lesson_id);
                    const number = attempts
                      .filter((a) => a.quiz_id === attempt.quiz_id)
                      .indexOf(attempt);
                    return (
                      <MarkItem
                        key={attempt.id}
                        tone={attempt.passed ? "ready" : "attention"}
                        mark={attempt.passed ? <Check /> : <RotateCcw />}
                        title={`اختبار ${lesson ? lessonName(lesson) : "الدرس"}`}
                        detail={
                          <Meta
                            parts={[
                              `المحاولة ${arabicNumber(number + 1)}`,
                              simDay(attempt.sim_day),
                              attempt.passed ? "اجتزته" : "لم تجتزه بعد",
                            ]}
                          />
                        }
                        value={percent(attempt.score)}
                      />
                    );
                  })}
                </MarkList>
              </>
            )}
          </Panel>

          <Panel
            id="week-title"
            title="أسبوعك الأول"
            sub={`${countOf(weekMinutes, MINUTES)} من ${countOf(seed.profile.hours_per_week, HOURS)} في الأسبوع`}
          >
            <MarkList>
              {weekOne.map((session, i) => {
                const lesson = seed.lessons.find((l) => l.id === session.lesson_id);
                return (
                  <MarkItem
                    key={session.id}
                    mark={<Calendar />}
                    title={`الجلسة ${ordinalF(i)}`}
                    detail={
                      <Meta
                        parts={[
                          simDay(session.day),
                          countOf(session.minutes, MINUTES),
                          lesson ? lessonName(lesson) : "مراجعة",
                        ]}
                      />
                    }
                    value={<StatusPill status="waiting">مجدولة</StatusPill>}
                  />
                );
              })}
            </MarkList>
          </Panel>
        </Stack>
      </Columns>
    </Page>
  );
}
