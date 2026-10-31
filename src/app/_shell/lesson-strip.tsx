import { ArrowRight, CircleCheck, Lock } from "lucide-react";
import Link from "next/link";
import { arabicNumber, ordinal, percent } from "./format.ts";
import styles from "./lesson-strip.module.css";
import { type CourseLesson, currentLesson } from "./lessons.ts";
import { BidiText, DirIcon } from "./ui.tsx";

// The plan's committed lessons in order (#34), each with where the quiz gate leaves it: passed, the
// lesson the learner is on, or shut until the quiz before it is passed. Open lessons link to their
// page; `here` marks the lesson the page is about.
export function LessonStrip({
  lessons,
  labelledBy,
  here,
}: {
  lessons: CourseLesson[];
  labelledBy: string;
  here?: string;
}) {
  const current = currentLesson(lessons);
  return (
    <ol className={styles.strip} aria-labelledby={labelledBy}>
      {lessons.map((l) => {
        const state = l.passed ? "passed" : l.open ? "current" : "locked";
        const isHere = l.planned.id === here;
        const body = (
          <>
            <span className={styles.num} aria-hidden>
              {arabicNumber(l.position + 1)}
            </span>
            <span className={styles.body}>
              <span className={styles.kick}>
                الدرس {ordinal(l.position)}
                {isHere ? (
                  <span className={styles.badge}>هذا الدرس</span>
                ) : (
                  l === current && !l.passed && <span className={styles.badge}>درسك الآن</span>
                )}
              </span>
              <span className={styles.title}>
                <BidiText text={l.planned.title_ar} />
              </span>
              <span className={styles.state}>{stateText(l)}</span>
            </span>
          </>
        );
        return (
          <li key={l.planned.id}>
            {l.open ? (
              <Link
                href={`/lesson/${l.planned.id}`}
                className={styles.card}
                data-state={state}
                aria-current={isHere ? "page" : undefined}
              >
                {body}
              </Link>
            ) : (
              <div
                className={styles.card}
                data-state={state}
                aria-current={isHere ? "page" : undefined}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function stateText(l: CourseLesson) {
  if (l.passed) {
    return (
      <>
        <CircleCheck aria-hidden />
        اجتزته بنسبة {percent(l.best ?? 1)}
      </>
    );
  }
  if (!l.open) {
    return (
      <>
        <Lock aria-hidden />
        يُفتح حين تجتاز اختبار الدرس {ordinal(l.position - 1)}
      </>
    );
  }
  return (
    <>
      <DirIcon icon={ArrowRight} />
      {!l.written
        ? "مفتوح، ويُكتب حين تفتحه"
        : l.best !== undefined
          ? `أفضل نتيجة لك ${percent(l.best)}، أعد الاختبار حين تكون جاهزًا`
          : "مفتوح وجاهز لتبدأه"}
    </>
  );
}
