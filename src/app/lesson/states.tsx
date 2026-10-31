import { ArrowRight, BookOpen, Lock, SearchX } from "lucide-react";
import Link from "next/link";
import { PASS_THRESHOLD } from "../../server/agents/examiner/examiner.ts";
import { EmptyState, Page, PageHead } from "../_shell/blocks.tsx";
import { ordinal, percent } from "../_shell/format.ts";
import { LessonStrip } from "../_shell/lesson-strip.tsx";
import { type CourseLesson, currentLesson } from "../_shell/lessons.ts";
import { BidiText, buttonClass, DirIcon, StatusPill } from "../_shell/ui.tsx";

// The lesson and quiz pages' states around a lesson (#34): before the plan, for a lesson the plan
// lacks, and for one the quiz gate keeps shut.

// Before the learner's plan is ready: the lesson builder starts once it is.
export function LessonWaiting() {
  return (
    <Page width="reading">
      <PageHead title="الدرس الأول" pill={<StatusPill status="waiting">لم يُكتب بعد</StatusPill>} />
      <EmptyState
        icon={BookOpen}
        text="يكتب صانع الدروس درسك الأول بعد أن تجهز خطتك، ويظهر هنا بجانب نصه الأصلي."
        actions={
          <Link href="/plan" className={buttonClass("secondary")}>
            إلى الخطة
            <DirIcon icon={ArrowRight} />
          </Link>
        }
      />
    </Page>
  );
}

// A lesson id the plan lacks: an old or cut link.
export function MissingLesson() {
  return (
    <Page width="reading">
      <EmptyState
        icon={SearchX}
        heading="h1"
        title="ليس في خطتك درس بهذا الرابط"
        titleId="missing-title"
        text="ربما تغيّرت خطتك أو نُسخ الرابط ناقصًا. دروسك كلها في خطتك."
        actions={
          <Link href="/plan" className={buttonClass("primary", "lg")}>
            اذهب إلى خطتك
            <DirIcon icon={ArrowRight} />
          </Link>
        }
      />
    </Page>
  );
}

// A lesson the quiz gate keeps shut: the quiz that opens it, or the lesson the learner is on when
// the one before is shut too, the way there, and the plan's lessons in order with this one marked.
export function LockedBody({ state, lessons }: { state: CourseLesson; lessons: CourseLesson[] }) {
  const before = lessons[state.position - 1];
  const way = before?.open ? before : currentLesson(lessons);
  if (!before || !way) return null;
  const name = (l: CourseLesson) => `الدرس ${ordinal(l.position)}`;
  return (
    <EmptyState
      icon={Lock}
      title={
        before.open
          ? `يُفتح هذا الدرس حين تجتاز اختبار ${name(before)}`
          : `يُفتح هذا الدرس بعد ${name(before)}، فالدروس تُفتح بالترتيب`
      }
      titleId="locked-title"
      text={
        <>
          {before.open ? "اجتز" : `أنت الآن في ${name(way)}. اجتز`} اختبار «
          <BidiText text={way.planned.title_ar} />» بنسبة {percent(PASS_THRESHOLD)} أو أكثر،
          {before.open ? " ويُفتح لك هذا الدرس." : " ويُفتح لك ما بعده."}
          {way.best !== undefined && ` أفضل نتيجة لك فيه حتى الآن ${percent(way.best)}.`}
        </>
      }
      actions={
        way.written ? (
          <>
            <Link href={`/quiz/${way.planned.id}`} className={buttonClass("primary")}>
              إلى اختبار {name(way)}
              <DirIcon icon={ArrowRight} />
            </Link>
            <Link href={`/lesson/${way.planned.id}`} className={buttonClass("secondary")}>
              اقرأ {name(way)}
            </Link>
          </>
        ) : (
          <Link href={`/lesson/${way.planned.id}`} className={buttonClass("primary")}>
            تابع إلى {name(way)}
            <DirIcon icon={ArrowRight} />
          </Link>
        )
      }
      preview={
        <>
          <h3 className="sr-only" id="locked-lessons">
            دروسك بالترتيب
          </h3>
          <LessonStrip lessons={lessons} labelledBy="locked-lessons" here={state.planned.id} />
        </>
      }
    />
  );
}
