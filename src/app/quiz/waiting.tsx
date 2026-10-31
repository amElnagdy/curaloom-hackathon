import { ArrowRight, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState, Page, PageHead } from "../_shell/blocks.tsx";
import { buttonClass, DirIcon, StatusPill } from "../_shell/ui.tsx";

// The quiz pages before the lesson is written (#34): the examiner writes a lesson's quiz from the
// lesson, while the learner reads it.
export function QuizWaiting({ lessonId }: { lessonId: string | undefined }) {
  return (
    <Page width="reading">
      <PageHead title="الاختبار" pill={<StatusPill status="waiting">لم يُكتب بعد</StatusPill>} />
      <EmptyState
        icon={ClipboardCheck}
        text={
          lessonId
            ? "يكتب الممتحن اختبار الدرس من الدرس نفسه، ويبدأ حين تفتح الدرس."
            : "يكتب الممتحن اختبار كل درس من الدرس نفسه، ويبدأ حين يجهز درسك الأول."
        }
        actions={
          <Link
            href={lessonId ? `/lesson/${lessonId}` : "/lesson"}
            className={buttonClass("secondary")}
          >
            إلى الدرس
            <DirIcon icon={ArrowRight} />
          </Link>
        }
      />
    </Page>
  );
}
