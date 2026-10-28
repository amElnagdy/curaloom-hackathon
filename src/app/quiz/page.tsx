// The quiz (#15 slot; quizzes, grading and the mastery gate are #20): the seeded quiz for the
// first lesson in the state every page shows (quizState: not tried, «أعد المحاولة» or passed), with
// the 80% gate explained and the seeded previous attempt with its feedback.

import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  ClipboardCheck,
  Gauge,
  Info,
  Lock,
  type LucideIcon,
  PenLine,
  RotateCcw,
  Target,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Quiz, QuizAttempt } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import {
  Callout,
  EmptyState,
  MarkItem,
  MarkList,
  MetaItem,
  Page,
  PageHead,
  Panel,
} from "../_shell/blocks.tsx";
import { latestPlan, type QuizState, quizState, sessionsOf, simDay } from "../_shell/course.ts";
import { ATTEMPTS, arabicNumber, countOf, ordinal, percent, QUESTIONS } from "../_shell/format.ts";
import { BidiText, buttonClass, DirIcon, Meta, StatusPill } from "../_shell/ui.tsx";
import styles from "./quiz.module.css";

export const metadata: Metadata = { title: "الاختبار" };

type Item = Quiz["items"][number];

const ITEM_TYPE: Record<Item["type"], string> = {
  mcq: "اختيار من متعدد",
  short: "إجابة قصيرة",
};

function scoreLabel(score: number): string {
  if (score >= 1) return "درجة كاملة";
  if (score === 0.5) return "نصف درجة";
  if (score <= 0) return "لا درجة";
  return `${percent(score)} من الدرجة`;
}

function AttemptAnswers({ quiz, attempt }: { quiz: Quiz; attempt: QuizAttempt }) {
  return (
    <ol className={styles.answers}>
      {attempt.answers.map((answer) => {
        const item = quiz.items.find((i) => i.id === answer.item_id);
        const full = answer.score >= 1;
        return (
          <li key={answer.item_id} className={styles.answer}>
            <p className={styles.prompt}>{item ? <BidiText text={item.prompt_ar} /> : "سؤال"}</p>
            <p className={styles.response}>
              <span className={styles.responseLabel}>إجابتك</span>
              <bdi dir="auto">{answer.response}</bdi>
            </p>
            <Callout icon={full ? CircleCheck : Info} tone={full ? "ready" : "attention"}>
              <b>{scoreLabel(answer.score)}.</b> <BidiText text={answer.feedback_ar} />
            </Callout>
          </li>
        );
      })}
    </ol>
  );
}

// The quiz's main block, as its state allows: opens after the lesson (not tried yet), review and
// retry (below the gate), or done.
function nextStep(state: QuizState): {
  icon: LucideIcon;
  title: string;
  text: string;
  href: string;
  action: string;
} {
  const gate = percent(state.gate);
  if (state.best === undefined) {
    return {
      icon: Lock,
      title: "يُفتح الاختبار بعد الدرس",
      text: `أسئلة الاختبار من الدرس نفسه. حين تنهي الدرس يُفتح الاختبار، وتجتازه عند ${gate} أو أكثر.`,
      href: "/lesson",
      action: "اذهب إلى الدرس",
    };
  }
  const best = percent(state.best);
  if (state.passed) {
    return {
      icon: CircleCheck,
      title: "اجتزت هذا الاختبار",
      text: `أفضل نتيجة لك ${best}، والنجاح عند ${gate}. يُفتح لك الدرس التالي.`,
      href: "/plan",
      action: "اذهب إلى خطتك",
    };
  }
  return {
    icon: RotateCcw,
    title: "أعد المحاولة بعد مراجعة الدرس",
    text: `أفضل نتيجة لك ${best}، والنجاح عند ${gate}. راجع ما فاتك في الدرس، ثم أعد الاختبار.`,
    href: "/lesson",
    action: "راجع الدرس",
  };
}

export default function QuizPage() {
  const seed = loadOmarSeed(config.demoTopic);
  const plan = latestPlan(seed);
  const firstLessonId = plan && sessionsOf(plan)[0]?.lesson_id;
  const lessonId = firstLessonId ?? seed.quizzes[0]?.lesson_id;
  const state = lessonId ? quizState(seed, lessonId) : undefined;

  if (!state) {
    return (
      <Page width="reading">
        <PageHead title="الاختبار" pill={<StatusPill status="waiting">لم يُكتب بعد</StatusPill>} />
        <EmptyState
          icon={ClipboardCheck}
          text="يكتب الممتحن اختبار كل درس من الدرس نفسه، ويظهر هنا حين يجهز الدرس."
        />
      </Page>
    );
  }

  const { quiz, attempts } = state;
  const lessonTitle = `الدرس ${ordinal(seed.lessons.findIndex((l) => l.id === quiz.lesson_id))}`;
  const gate = percent(state.gate);
  const last = attempts.at(-1);
  const next = nextStep(state);

  return (
    <Page width="reading">
      <PageHead
        title={`اختبار ${lessonTitle}`}
        pill={<StatusPill status={state.status}>{state.label}</StatusPill>}
        meta={
          <>
            <MetaItem icon={ClipboardCheck}>{countOf(quiz.items.length, QUESTIONS)}</MetaItem>
            <MetaItem icon={Target}>النجاح عند {gate}</MetaItem>
            {state.best !== undefined && (
              <MetaItem icon={Gauge}>أفضل نتيجة {percent(state.best)}</MetaItem>
            )}
            {state.tries > 0 && (
              <MetaItem icon={RotateCcw}>{countOf(state.tries, ATTEMPTS)}</MetaItem>
            )}
          </>
        }
        lede="الاختبار من الدرس نفسه، ويفتح لك الدرس التالي حين تجتازه."
      />

      <EmptyState
        icon={next.icon}
        title={next.title}
        titleId="quiz-next-title"
        text={next.text}
        actions={
          <Link href={next.href} className={buttonClass("primary", "lg")}>
            {next.action}
            <DirIcon icon={ArrowRight} />
          </Link>
        }
        preview={
          <>
            <h3 className={styles.previewTitle}>ما في الاختبار</h3>
            <MarkList>
              {quiz.items.map((item) => (
                <MarkItem
                  key={item.id}
                  mark={<CircleDashed />}
                  title={<BidiText text={item.prompt_ar} />}
                  detail={<Meta parts={[ITEM_TYPE[item.type], "درجة واحدة"]} />}
                />
              ))}
            </MarkList>
          </>
        }
      />

      <Panel id="gate-title" title={`كيف تجتاز ${lessonTitle}`}>
        <MarkList>
          <MarkItem
            mark={<Target />}
            title={`النجاح عند ${gate} أو أكثر`}
            detail="لكل سؤال درجة واحدة، ونتيجتك متوسط درجاتك. حين تصل إلى حد النجاح يُفتح الدرس التالي."
          />
          {quiz.items
            .filter((item) => item.type === "short")
            .map((item) => (
              <MarkItem
                key={item.id}
                mark={<PenLine />}
                title="الإجابة القصيرة يصححها الممتحن"
                detail={
                  <>
                    وفق معيار مكتوب: <BidiText text={item.rubric_ar} />
                  </>
                }
              />
            ))}
          <MarkItem
            mark={<RotateCcw />}
            title="إن لم تصل إلى حد النجاح"
            detail="تراجع الدرس ثم تعيد المحاولة. وإن تأخرت، يقترح المدرب خطة أخف بدل التذكير المتكرر."
          />
        </MarkList>
      </Panel>

      {last && (
        <Panel
          id="attempt-title"
          title="محاولتك السابقة"
          sub={<Meta parts={[`المحاولة ${arabicNumber(attempts.length)}`, simDay(last.sim_day)]} />}
          aside={
            <StatusPill status={last.passed ? "ready" : "attention"}>
              {last.passed
                ? `اجتزته بنسبة ${percent(last.score)}`
                : `${percent(last.score)}، لم تجتزه بعد`}
            </StatusPill>
          }
        >
          <AttemptAnswers quiz={quiz} attempt={last} />
        </Panel>
      )}
    </Page>
  );
}
