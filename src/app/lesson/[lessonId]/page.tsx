// A lesson of the learner's plan, by its id (#19, #34). Each section puts the Arabic beside the
// original excerpt; a glossary term in the Arabic opens its card and marks the source term in the
// excerpt. Under the lesson, the sources it quotes with their licences and what the Arabic changed,
// then the glossary. Before the intake it shows the seed's lesson as an example. A lesson the quiz
// gate keeps shut names the quiz that opens it; an open one not written yet is asked of the lesson
// builder on first open. With the lesson shown, its foot asks the examiner for the lesson's first
// quiz (#20), which is written while the learner reads; a new quiz after an attempt below the gate
// is asked for on the quiz page.

import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  ImageIcon,
  Languages,
  Layers,
  Library,
  Lightbulb,
  PenLine,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { type CSSProperties, Fragment, type ReactNode } from "react";
import type {
  Diagram,
  GlossaryEntry,
  Lesson,
  Quiz,
  Resource,
} from "../../../../contracts/index.ts";
import { DEMO_SESSION_ID } from "../../../../demo/session.ts";
import { config } from "../../../config.ts";
import { lessonDiagramsBrief, savedDiagrams } from "../../../server/agents/diagrams/diagrams.ts";
import { forbidsChanges } from "../../../server/agents/diagrams/wiki.ts";
import { quizView } from "../../../server/agents/examiner/examiner.ts";
import type { QuizView } from "../../../server/agents/examiner/rules.ts";
import { sourceMarks, type TermMark, termMarks } from "../../../server/agents/lesson/rules.ts";
import { createFileStore } from "../../../server/store/store.ts";
import {
  CallMark,
  Callout,
  MetaItem,
  Page,
  PageHead,
  Panel,
  SourceExcerpt,
} from "../../_shell/blocks.tsx";
import { unique } from "../../_shell/course.ts";
import {
  arabicNumber,
  countOf,
  creditLine,
  MINUTES,
  ordinal,
  percent,
  QUESTIONS,
} from "../../_shell/format.ts";
import { type CourseLesson, learnerCourse } from "../../_shell/lessons.ts";
import {
  BidiText,
  buttonClass,
  DirIcon,
  LANG_NAMES,
  LangBadge,
  LicenceTag,
  Meta,
  StatusPill,
} from "../../_shell/ui.tsx";
import styles from "../lesson.module.css";
import { LessonWaiting, LockedBody, MissingLesson } from "../states.tsx";
import {
  CopyButton,
  DiagramsBuilding,
  ExcerptMark,
  LessonBuilding,
  QuizBuilding,
  Term,
  Terms,
  WritingBody,
  WritingDone,
  WritingLede,
  WritingStatus,
} from "../terms.tsx";

export const metadata: Metadata = { title: "الدرس" };

// What the page shows: nothing yet before the plan, a lesson the plan lacks, a lesson the quiz gate
// keeps shut, a lesson being written, or a lesson, the seed's (`sample`) or the learner's.
type Shown =
  | { kind: "waiting" }
  | { kind: "missing"; lessonId: string }
  | { kind: "locked"; state: CourseLesson; lessons: CourseLesson[] }
  | { kind: "writing"; name: string; state: CourseLesson }
  | {
      kind: "lesson";
      sample: boolean;
      state: CourseLesson;
      lesson: Lesson;
      // The lesson's own entries of the course glossary.
      glossary: GlossaryEntry[];
      sources: QuotedSource[];
      quiz: LessonQuiz;
      diagrams: Diagram[] | "making";
    };

// The lesson's quiz as its foot shows it: the seed's, under the example, or the learner's quizzes.
type LessonQuiz = { sample: true; quiz: Quiz | undefined } | { sample: false; view: QuizView };

// The lesson's sources in the order it first quotes them, each with the call mark that ties its
// excerpts to its card: R1, R2.
type QuotedSource = { resource: Resource; mark: string };
const quotedSources = (lesson: Lesson, resources: Resource[]): QuotedSource[] =>
  unique(lesson.sections.map((s) => s.source_excerpt.resource_id)).flatMap((id, i) =>
    resources.filter((r) => r.id === id).map((resource) => ({ resource, mark: `R${i + 1}` })),
  );

function shownLesson(lessonId: string): Shown {
  const course = learnerCourse();
  if (!course) return { kind: "waiting" };
  const state = course.states.find((s) => s.planned.id === lessonId);
  if (!state) return { kind: "missing", lessonId };
  if (!state.open) {
    return { kind: "locked", state, lessons: course.states };
  }
  const lesson = course.lessons[lessonId];
  if (!lesson) {
    return course.sample ? { kind: "waiting" } : { kind: "writing", name: course.name, state };
  }
  const quiz: LessonQuiz = course.sample
    ? { sample: true, quiz: course.quizzes.quizzes.find((q) => q.lesson_id === lessonId) }
    : { sample: false, view: quizView(course.quizzes, lessonId) };
  const brief = course.sample ? undefined : lessonDiagramsBrief(course, lessonId);
  return {
    kind: "lesson",
    sample: course.sample,
    state,
    lesson,
    glossary: lesson.glossary_ids.flatMap((id) => course.glossary.filter((g) => g.id === id)),
    sources: quotedSources(lesson, course.resources),
    quiz,
    diagrams: brief ? (savedDiagrams(createFileStore(), DEMO_SESSION_ID, brief) ?? "making") : [],
  };
}

// The text cut at the marks: the parts between them as they are, each mark through `mark`.
function cut(
  text: string,
  marks: TermMark[],
  plain: (part: string) => ReactNode,
  mark: (part: string, m: TermMark, i: number) => ReactNode,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  marks.forEach((m, i) => {
    parts.push(
      <Fragment key={`t${at}`}>{plain(text.slice(at, m.start))}</Fragment>,
      <Fragment key={`m${m.start}`}>{mark(text.slice(m.start, m.end), m, i)}</Fragment>,
    );
    at = m.end;
  });
  parts.push(<Fragment key="end">{plain(text.slice(at))}</Fragment>);
  return parts;
}

function LessonSection({
  section,
  index,
  glossary,
  source,
  sample,
  children,
}: {
  section: Lesson["sections"][number];
  index: number;
  glossary: GlossaryEntry[];
  source: QuotedSource | undefined;
  sample: boolean;
  children?: ReactNode;
}) {
  const byId = new Map(glossary.map((e) => [e.id, e]));
  const marks = termMarks(section.arabic, glossary);
  const arabic = cut(
    section.arabic,
    marks,
    (part) => <BidiText text={part} />,
    (part, m, i) => {
      const entry = byId.get(m.id);
      const text = <BidiText text={part} />;
      return entry ? (
        <Term entry={entry} section={index} index={i}>
          {text}
        </Term>
      ) : (
        text
      );
    },
  );
  const used = glossary.filter((e) => marks.some((m) => m.id === e.id));
  const { text } = section.source_excerpt;
  const excerpt = cut(
    text,
    sourceMarks(text, used),
    (part) => part,
    (part, m) => (
      <ExcerptMark id={m.id} section={index}>
        {part}
      </ExcerptMark>
    ),
  );
  return (
    <section
      id={`section-${index + 1}`}
      className={styles.section}
      aria-label={`القسم ${ordinal(index)}`}
    >
      <div className={styles.arabic}>
        <div className={styles.columnHead}>
          <LangBadge lang="ar" full />
          <span>الشرح</span>
        </div>
        <p className={styles.reading}>{arabic}</p>
        <Callout icon={Lightbulb} tone="accent">
          <BidiText text={section.notes_ar} />
        </Callout>
      </div>
      <SourceExcerpt
        excerpt={section.source_excerpt}
        resource={source?.resource}
        callMark={source?.mark}
        sample={sample}
      >
        {excerpt}
      </SourceExcerpt>
      {children}
    </section>
  );
}

const PUBLIC_DOMAIN = "LicenseRef-PublicDomain";
const SHARE_ALIKE = /-SA(-|$)/;
// A diagram is shown as wide as fills this height, up to this width, in rem.
const FIGURE_HEIGHT = 24;
const FIGURE_MAX_WIDTH = 54;

function legendTables(labels: Diagram["labels"]): Diagram["labels"][] {
  const rows = labels.filter(
    (l, i) => labels.findIndex((k) => k.src === l.src && k.ar === l.ar) === i,
  );
  const half = rows.length > 6 ? Math.ceil(rows.length / 2) : rows.length;
  return [rows.slice(0, half), rows.slice(half)].filter((t) => t.length);
}

function DiagramFigure({ diagram, lessonId }: { diagram: Diagram; lessonId: string }) {
  const { caption_ar, source, output, licence, author, file } = diagram;
  const url = (ref: string) =>
    `/api/sessions/${encodeURIComponent(DEMO_SESSION_ID)}/diagrams/${encodeURIComponent(lessonId)}/${ref}`;
  const titleId = `${diagram.image_id}-title`;
  const fit = Math.min(FIGURE_MAX_WIDTH, (FIGURE_HEIGHT * source.width) / source.height);
  const frame = { "--ratio": `${source.width} / ${source.height}`, "--fit": `${fit}rem` };
  const shareAlike = SHARE_ALIKE.test(licence.spdx);
  return (
    <figure className={styles.figure} aria-labelledby={titleId}>
      <div className={styles.figHead}>
        <p className={styles.figTitle} id={titleId}>
          <ImageIcon aria-hidden />
          <BidiText text={caption_ar} />
        </p>
        {output && (
          <fieldset className={styles.versions}>
            <legend className="sr-only">نسخة الرسم</legend>
            <label>
              <input type="radio" name={diagram.image_id} value="arabic" defaultChecked />
              بالعربية
            </label>
            <label>
              <input type="radio" name={diagram.image_id} value="source" />
              الأصل
            </label>
          </fieldset>
        )}
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: on a phone it scrolls sideways, and the keyboard must reach it */}
      <section className={styles.well} tabIndex={0} aria-label="الرسم">
        <div className={styles.frame} style={frame as CSSProperties}>
          {output && (
            <Image
              className={styles.arabicImage}
              src={url(output.ref)}
              alt={`${caption_ar}، بتسميات عربية`}
              fill
              unoptimized
            />
          )}
          <Image
            className={styles.sourceImage}
            src={url(source.ref)}
            alt={`${caption_ar}، كما في مصدره`}
            fill
            unoptimized
          />
        </div>
      </section>
      {!output && (
        <div className={styles.legendWrap}>
          {legendTables(diagram.labels).map((rows) => (
            <table key={`${rows[0]?.src}:${rows[0]?.ar}`} className={styles.legend}>
              <thead>
                <tr>
                  <th scope="col">في الأصل</th>
                  <th scope="col">بالعربية</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={`${l.src}:${l.ar}`}>
                    <td>
                      <bdi dir="auto">{l.src}</bdi>
                    </td>
                    <td>
                      <BidiText text={l.ar} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
      <figcaption className={styles.credit}>
        <p className={styles.figNote}>
          <Languages aria-hidden />
          <span>
            {output
              ? "تُرجمت تسميات هذا الرسم إلى العربية، وبقي الباقي كما هو."
              : licence.adapt
                ? "لم تجتز النسخة العربية من هذا الرسم فحص الكود، فبقي كما في مصدره، وهذه ترجمة تسمياته."
                : forbidsChanges(licence.spdx)
                  ? "ترخيص هذا الرسم لا يسمح بتعديله، فبقي كما في مصدره، وهذه ترجمة تسمياته."
                  : "لا يُعدَّل رسم بهذا الترخيص، فبقي كما في مصدره، وهذه ترجمة تسمياته."}
            {output && shareAlike && (
              <>
                {" "}
                والنسخة العربية متاحة بالترخيص نفسه، <bdi lang="en">{licence.name}</bdi>.
              </>
            )}
          </span>
        </p>
        <p className={styles.attr}>
          {author && (
            <span>
              صاحب الرسم <bdi dir="auto">{author}</bdi>
            </span>
          )}
          {licence.spdx === PUBLIC_DOMAIN ? (
            <span title="قرأ الكود الترخيص من صفحة الملف">ملكية عامة</span>
          ) : licence.url ? (
            <a href={licence.url} target="_blank" rel="noopener noreferrer" lang="en" dir="ltr">
              {licence.name}
              <span className="sr-only"> (يفتح في نافذة جديدة)</span>
            </a>
          ) : (
            <bdi lang="en">{licence.name}</bdi>
          )}
          <a href={file.page_url} target="_blank" rel="noopener noreferrer">
            صفحة الملف
            <ExternalLink aria-hidden />
            <span className="sr-only"> (يفتح في نافذة جديدة، ومنها قرأ الكود الترخيص)</span>
          </a>
        </p>
      </figcaption>
    </figure>
  );
}

// The ShareAlike licence the Arabic carries, when one can hold every quoted source: the sources
// under it, and the rest open and not ShareAlike. A source under it that is limited to personal
// study fits only a NonCommercial one. Otherwise the Arabic carries none the note can name.
function carriedLicence(licences: Resource["licence"][]): string | undefined {
  const shareAlike = unique(licences.map((l) => l.spdx).filter((id) => SHARE_ALIKE.test(id)));
  const [only] = shareAlike.length === 1 ? shareAlike : [];
  if (!only) return undefined;
  const fits = (l: Resource["licence"]) =>
    l.spdx === only
      ? l.use === "open" || /-NC(-|$)/.test(only)
      : l.use === "open" && !SHARE_ALIKE.test(l.spdx);
  return licences.every(fits) ? only : undefined;
}

// The sources the lesson quotes, a row each with what a reuser needs to credit it, and what the
// Arabic changed.
function SourcesPanel({ lesson, sources }: { lesson: Lesson; sources: QuotedSource[] }) {
  if (!sources.length) return null;
  const quotedIds = lesson.sections.map((s) => s.source_excerpt.resource_id);
  const licences = unique(sources.map((s) => s.resource.licence.spdx));
  const [sharedLicence] = licences.length === 1 ? licences : [];
  const carried = carriedLicence(sources.map((s) => s.resource.licence));
  const single = sources.length === 1;
  return (
    <details className={styles.sources} id="sources">
      <summary>
        <span className={styles.sourcesIcon} aria-hidden>
          <Library />
        </span>
        <span className={styles.sourcesText}>
          <span className={styles.sourcesTitle}>المصادر والتراخيص</span>
          <span className={styles.sourcesSub}>
            الشرح العربي مبني على مقتطفات من {single ? "مصدر الدرس" : "مصادر الدرس"}، وليس ترجمة
            لها.
          </span>
        </span>
        <span className={styles.sourcesMarks}>
          {unique(sources.map((s) => s.resource.lang)).map((lang) => (
            <LangBadge key={lang} lang={lang} />
          ))}
          {sharedLicence && (
            <span className={styles.sourcesLicence} lang="en" dir="ltr">
              {sharedLicence}
            </span>
          )}
        </span>
        <ChevronDown className={styles.chev} aria-hidden />
      </summary>
      <div className={styles.sourcesBody}>
        <ul className={styles.sourceList}>
          {sources.map(({ resource: r, mark }) => (
            <li key={r.id} className={styles.sourceItem}>
              <div className={styles.sourceHead}>
                <CallMark resource={r} label={mark} />
                <a
                  className={styles.sourceTitle}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <bdi lang={r.lang}>{r.title}</bdi>
                  <ExternalLink aria-hidden />
                  <span className="sr-only"> (يفتح في نافذة جديدة)</span>
                </a>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>اللغة</dt>
                  <dd className={styles.factLang}>
                    <LangBadge lang={r.lang} />
                    {LANG_NAMES[r.lang]}
                  </dd>
                </div>
                <div>
                  <dt>الترخيص</dt>
                  <dd className={styles.factLicence}>
                    <LicenceTag licence={r.licence} />
                    <a href={r.licence.evidence_url} target="_blank" rel="noopener noreferrer">
                      حيث وجده الكود
                      <span className="sr-only"> (يفتح في نافذة جديدة)</span>
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>في الدرس</dt>
                  <dd>
                    {quotedIds
                      .flatMap((id, i) => (id === r.id ? [i] : []))
                      .map((i, n) => (
                        <Fragment key={i}>
                          {n > 0 && "، "}
                          <a href={`#section-${i + 1}`}>القسم {ordinal(i)}</a>
                        </Fragment>
                      ))}
                  </dd>
                </div>
              </dl>
              <CopyButton text={creditLine(r, config.appName)} />
            </li>
          ))}
        </ul>
        <div className={styles.changes}>
          <PenLine aria-hidden />
          <div>
            <h3>ما الذي غيّرناه</h3>
            <p>
              الشرح العربي في هذا الدرس ليس ترجمة {single ? "لهذا المصدر" : "لهذه المصادر"}. كتبه
              صانع الدروس شرحًا مبنيًا على المقتطفات المعروضة بجانبه، فاختصر وأعاد الترتيب وأضاف أمثلة
              من عملك، أما المقتطفات نفسها فمنقولة كما هي، بلا ما كان بين أقواس مربعة، كأرقام
              الحواشي وملاحظات المحررين.
              {carried && carried === sharedLicence && (
                <>
                  {" "}
                  ولأن {single ? "المصدر" : "المصادر"} بترخيص <bdi lang="en">{carried}</bdi>، فالشرح
                  العربي متاح بالترخيص نفسه.
                </>
              )}
              {carried && carried !== sharedLicence && (
                <>
                  {" "}
                  ولأن من المصادر ما ترخيصه <bdi lang="en">{carried}</bdi>، فالشرح العربي متاح بهذا
                  الترخيص.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}

function GlossaryItem({ entry }: { entry: GlossaryEntry }) {
  return (
    <div className={styles.glossItem} id={`glossary-${entry.id}`}>
      <dt className={styles.glossTerm}>
        <b>{entry.ar}</b>
        <span className={styles.diacritized}>{entry.ar_diacritized}</span>
      </dt>
      <dd className={styles.glossDef}>
        <p>
          <BidiText text={entry.definition_ar} />
        </p>
        <p className={styles.example}>
          مثال: <BidiText text={entry.example_ar} />
        </p>
        <p className={styles.glossSrc}>
          <LangBadge lang={entry.src.lang} />
          <bdi lang={entry.src.lang}>{entry.src.term}</bdi>
          <span>كما يكتبه المصدر</span>
        </p>
      </dd>
    </div>
  );
}

// Under the lesson, the way to its quiz: the first one being written while the learner reads, then
// the quiz to take or its result.
function LessonFoot({ lessonId, quiz }: { lessonId: string; quiz: LessonQuiz }) {
  if (quiz.sample) {
    const sample = quiz.quiz;
    return (
      <footer className={styles.footer}>
        <p>
          {sample ? (
            <>
              بعد الدرس اختبار قصير فيه {countOf(sample.items.length, QUESTIONS)}، وتجتاز الدرس حين
              تحصل على {percent(sample.pass_threshold)} أو أكثر.
            </>
          ) : (
            "بعد الدرس اختبار قصير يكتبه الممتحن من الدرس نفسه."
          )}
        </p>
        <Link href={`/quiz/${lessonId}`} className={buttonClass("secondary")}>
          اطّلع على الاختبار
          <DirIcon icon={ArrowRight} />
        </Link>
      </footer>
    );
  }
  const { view } = quiz;
  const last = view.quizzes.at(-1);
  return (
    <QuizBuilding sessionId={DEMO_SESSION_ID} lessonId={lessonId} build={!last}>
      {last && <QuizWay view={view} last={last} />}
    </QuizBuilding>
  );
}

// The way to the lesson's latest quiz. After an attempt below the gate it leads to the result, where
// the learner asks for a new quiz once he is ready, so the result stays until then.
function QuizWay({ view, last }: { view: QuizView; last: Quiz }) {
  const gate = percent(last.pass_threshold);
  const best = percent(view.mastery?.best_score ?? 0);
  if (view.mastery?.passed) {
    return (
      <footer className={styles.footer}>
        <p>اجتزت اختبار هذا الدرس بنسبة {best}.</p>
        <Link href={`/quiz/${last.lesson_id}`} className={buttonClass("secondary")}>
          راجع نتيجتك
          <DirIcon icon={ArrowRight} />
        </Link>
      </footer>
    );
  }
  if (!view.attempts.length) {
    return (
      <footer className={styles.footer}>
        <p>{`بعد الدرس اختبار قصير فيه ${countOf(last.items.length, QUESTIONS)}، وتجتازه عند ${gate}.`}</p>
        <Link href={`/quiz/${last.lesson_id}`} className={buttonClass("primary")}>
          ابدأ الاختبار
          <DirIcon icon={ArrowRight} />
        </Link>
      </footer>
    );
  }
  const graded = view.attempts.some((a) => a.quiz_id === last.id);
  return (
    <footer className={styles.footer}>
      <p>
        {`أفضل نتيجة لك ${best}، والنجاح عند ${gate}. `}
        {graded
          ? "حين تكون جاهزًا، ابدأ من صفحة نتيجتك اختبارًا جديدًا بأسئلة أخرى من الدرس نفسه."
          : "الاختبار الجديد بأسئلة أخرى من الدرس نفسه."}
      </p>
      <Link href={`/quiz/${last.lesson_id}`} className={buttonClass("primary")}>
        {graded ? "إلى نتيجتك" : "أعد الاختبار"}
        <DirIcon icon={ArrowRight} />
      </Link>
    </footer>
  );
}

function LessonView({ shown }: { shown: Extract<Shown, { kind: "lesson" }> }) {
  const { lesson, sample, quiz, sources, glossary, diagrams } = shown;
  const last = lesson.sections.length - 1;
  const figuresOf = (index: number) =>
    diagrams === "making"
      ? []
      : diagrams
          .filter((d) => Math.min(d.section, last) === index)
          .map((d) => <DiagramFigure key={d.image_id} diagram={d} lessonId={lesson.id} />);
  return (
    <>
      <Terms>
        <article className={styles.lesson} aria-label="نص الدرس">
          <section className={styles.objectives} aria-labelledby="objectives-title">
            <h2 id="objectives-title">ستتعلم في هذا الدرس</h2>
            <ul>
              {lesson.objectives_ar.map((objective) => (
                <li key={objective}>
                  <Check aria-hidden />
                  <span>
                    <BidiText text={objective} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {lesson.sections.map((section, i) => (
            <LessonSection
              key={`${section.source_excerpt.resource_id}:${section.source_excerpt.text}`}
              section={section}
              index={i}
              glossary={glossary}
              source={sources.find((s) => s.resource.id === section.source_excerpt.resource_id)}
              sample={sample}
            >
              {figuresOf(i)}
            </LessonSection>
          ))}

          {diagrams === "making" && (
            <DiagramsBuilding sessionId={DEMO_SESSION_ID} lessonId={lesson.id} />
          )}
          {/* Stays in place when the diagram arrives, so a screen reader hears it arrive. */}
          <p className="sr-only" role="status">
            {diagrams === "making"
              ? ""
              : diagrams.map((d) => `رسم الدرس جاهز: ${d.caption_ar}`).join("، ")}
          </p>

          <LessonFoot lessonId={lesson.id} quiz={quiz} />
        </article>
      </Terms>

      <SourcesPanel lesson={lesson} sources={sources} />

      {glossary.length > 0 && (
        <Panel
          id="glossary-title"
          title="المصطلحات"
          sub="كل مصطلح بالعربية مع تشكيله، ومعه اسمه كما يكتبه المصدر."
        >
          <dl className={styles.gloss}>
            {glossary.map((entry) => (
              <GlossaryItem key={entry.id} entry={entry} />
            ))}
          </dl>
        </Panel>
      )}
    </>
  );
}

// The page head for a lesson the gate keeps shut, one being written, the seed's example or the
// learner's lesson.
function headOf(shown: Exclude<Shown, { kind: "waiting" | "missing" }>): {
  title: string;
  pill: ReactNode;
  lede: ReactNode;
  sources: QuotedSource[];
} {
  if (shown.kind === "locked") {
    return {
      title: shown.state.planned.title_ar,
      pill: <StatusPill status="neutral">مقفل</StatusPill>,
      lede: undefined,
      sources: [],
    };
  }
  if (shown.kind === "writing") {
    return {
      title: shown.state.planned.title_ar,
      pill: <WritingStatus />,
      lede: <WritingLede name={shown.name} />,
      sources: [],
    };
  }
  const { lesson, sources } = shown;
  if (!shown.sample) {
    return {
      title: lesson.title_ar,
      pill: <StatusPill status="ready">جاهز</StatusPill>,
      lede: undefined,
      sources,
    };
  }
  return {
    title: lesson.title_ar,
    pill: <StatusPill status="neutral">مثال</StatusPill>,
    lede: (
      <>
        <b>هذا درس مثال.</b> أكمل <Link href="/intake">المقابلة</Link> لنكتب دروسك أنت من مصادر
        دورتك.
      </>
    ),
    sources,
  };
}

export default async function LessonPage({ params }: PageProps<"/lesson/[lessonId]">) {
  await connection();
  const { lessonId } = await params;
  const shown = shownLesson(lessonId);

  if (shown.kind === "waiting") return <LessonWaiting />;
  if (shown.kind === "missing") return <MissingLesson />;

  const { state } = shown;
  const head = headOf(shown);
  const langs = unique(head.sources.map((s) => s.resource.lang));
  const pageHead = (
    <PageHead
      titleId="lesson-title"
      title={<BidiText text={head.title} />}
      pill={head.pill}
      lede={head.lede}
      meta={
        <>
          <MetaItem icon={BookOpen}>الدرس {ordinal(state.position)}</MetaItem>
          {state.module && (
            <MetaItem icon={Layers}>
              <Meta
                parts={[`الوحدة ${arabicNumber(state.module.index + 1)}`, state.module.title]}
              />
            </MetaItem>
          )}
          {state.session && (
            <MetaItem icon={Clock}>{countOf(state.session.minutes, MINUTES)}</MetaItem>
          )}
          {langs.length > 0 && (
            <MetaItem icon={Languages}>
              {`من ${head.sources.length === 1 ? "مصدر" : "مصادر"} ب${langs.map((l) => LANG_NAMES[l]).join(" و")}`}
            </MetaItem>
          )}
        </>
      }
    />
  );

  if (shown.kind === "locked") {
    return (
      <Page width="reading">
        {pageHead}
        <LockedBody state={shown.state} lessons={shown.lessons} />
      </Page>
    );
  }

  return (
    <LessonBuilding
      key={lessonId}
      sessionId={DEMO_SESSION_ID}
      lessonId={lessonId}
      build={shown.kind === "writing"}
    >
      <Page>
        {pageHead}
        <WritingDone />
        {shown.kind === "writing" ? <WritingBody /> : <LessonView shown={shown} />}
      </Page>
    </LessonBuilding>
  );
}
