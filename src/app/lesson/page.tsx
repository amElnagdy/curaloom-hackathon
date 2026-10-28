// The lesson (#15 slot; the lesson builder is #19): lesson L1 from Omar's seed. Each section puts
// the Arabic beside the original excerpt (language, locator, licence, source mark), then the
// glossary with the term in every source language.

import { ArrowRight, BookOpen, Check, Clock, Languages, Layers, Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { type GlossaryEntry, type Resource, SOURCE_LANGS } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import {
  Callout,
  EmptyState,
  MetaItem,
  Page,
  PageHead,
  Panel,
  SourceExcerpt,
} from "../_shell/blocks.tsx";
import { latestPlan, lessonPlace, sessionsOf } from "../_shell/course.ts";
import { arabicNumber, countOf, MINUTES, ordinal, percent, QUESTIONS } from "../_shell/format.ts";
import {
  BidiText,
  buttonClass,
  DirIcon,
  LANG_NAMES,
  LangBadge,
  Meta,
  StatusPill,
} from "../_shell/ui.tsx";
import styles from "./lesson.module.css";

export const metadata: Metadata = { title: "الدرس" };

// The GlossaryEntry contract holds one source-language term (`src`). These sample translations
// show an entry in the course's other source languages until the lesson builder (#19) writes
// them. Display-only sample data, like the rest of the seed.
const SAMPLE_TERMS: Record<string, Partial<Record<Resource["lang"], string>>> = {
  g1: { ru: "сводная таблица", zh: "数据透视表", fr: "tableau croisé dynamique" },
};

function termsOf(entry: GlossaryEntry): [Resource["lang"], string][] {
  const terms: Partial<Record<Resource["lang"], string>> = {
    ...SAMPLE_TERMS[entry.id],
    [entry.src.lang]: entry.src.term,
  };
  return SOURCE_LANGS.flatMap((lang) => {
    const term = terms[lang];
    return term ? [[lang, term] as [Resource["lang"], string]] : [];
  });
}

function GlossaryItem({ entry }: { entry: GlossaryEntry }) {
  return (
    <div className={styles.glossItem}>
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
        <ul className={styles.glossLangs} aria-label="المصطلح في لغات المصادر">
          {termsOf(entry).map(([lang, term]) => (
            <li key={lang}>
              <LangBadge lang={lang} />
              <bdi lang={lang}>{term}</bdi>
              {lang === entry.src.lang && <span className={styles.fromSource}>من مصدر الدرس</span>}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

export default function LessonPage() {
  const seed = loadOmarSeed(config.demoTopic);
  const plan = latestPlan(seed);
  const firstLessonId = plan && sessionsOf(plan)[0]?.lesson_id;
  const lesson = seed.lessons.find((l) => l.id === firstLessonId) ?? seed.lessons[0];

  if (!lesson) {
    return (
      <Page width="reading">
        <PageHead
          title="الدرس الأول"
          pill={<StatusPill status="waiting">لم يُكتب بعد</StatusPill>}
        />
        <EmptyState
          icon={BookOpen}
          text="يكتب صانع الدروس درسك الأول بعد أن تجهز خطتك، ويظهر هنا بجانب نصه الأصلي."
        />
      </Page>
    );
  }

  const position = seed.lessons.indexOf(lesson);
  const { session, module } = plan
    ? lessonPlace(plan, lesson.id)
    : { session: undefined, module: undefined };
  const resource = (id: string) => seed.resources.find((r) => r.id === id);
  const sourceIds = [...new Set(lesson.sections.map((s) => s.source_excerpt.resource_id))];
  const langs = [...new Set(lesson.sections.map((s) => s.source_excerpt.lang))];
  const fromSources = `من ${sourceIds.length === 1 ? "مصدر" : "مصادر"} ب${langs.map((l) => LANG_NAMES[l]).join(" و")}`;
  const quiz = seed.quizzes.find((q) => q.lesson_id === lesson.id);
  const glossary = lesson.glossary_ids
    .map((id) => seed.glossary.find((g) => g.id === id))
    .filter((g) => g !== undefined);

  return (
    <Page>
      <PageHead
        title={<BidiText text={lesson.title_ar} />}
        pill={<StatusPill status="ready">جاهز</StatusPill>}
        meta={
          <>
            <MetaItem icon={BookOpen}>الدرس {ordinal(position)}</MetaItem>
            {module && (
              <MetaItem icon={Layers}>
                <Meta parts={[`الوحدة ${arabicNumber(module.index + 1)}`, module.title]} />
              </MetaItem>
            )}
            {session && <MetaItem icon={Clock}>{countOf(session.minutes, MINUTES)}</MetaItem>}
            <MetaItem icon={Languages}>{fromSources}</MetaItem>
          </>
        }
      />

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
          <section
            key={`${section.source_excerpt.resource_id}-${section.source_excerpt.locator}`}
            className={styles.section}
            aria-label={`القسم ${ordinal(i)}`}
          >
            <div className={styles.arabic}>
              <div className={styles.columnHead}>
                <LangBadge lang="ar" full />
                <span>الشرح</span>
              </div>
              <p className={styles.reading}>
                <BidiText text={section.arabic} />
              </p>
              <Callout icon={Lightbulb} tone="accent">
                <BidiText text={section.notes_ar} />
              </Callout>
            </div>
            <SourceExcerpt
              excerpt={section.source_excerpt}
              resource={resource(section.source_excerpt.resource_id)}
            />
          </section>
        ))}

        <footer className={styles.footer}>
          <p>
            {quiz ? (
              <>
                بعد الدرس اختبار قصير فيه {countOf(quiz.items.length, QUESTIONS)}، وتجتاز الدرس حين
                تحصل على {percent(quiz.pass_threshold)} أو أكثر.
              </>
            ) : (
              "بعد الدرس اختبار قصير يكتبه الممتحن من الدرس نفسه."
            )}
          </p>
          <Link href="/quiz" className={buttonClass("secondary")}>
            اطّلع على الاختبار
            <DirIcon icon={ArrowRight} />
          </Link>
        </footer>
      </article>

      {glossary.length > 0 && (
        <Panel
          id="glossary-title"
          title="المصطلحات"
          sub="كل مصطلح بالعربية مع تشكيله، ومعه اسمه في لغات المصادر."
        >
          <dl className={styles.gloss}>
            {glossary.map((entry) => (
              <GlossaryItem key={entry.id} entry={entry} />
            ))}
          </dl>
        </Panel>
      )}
    </Page>
  );
}
