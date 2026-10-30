// The rules every lesson keeps (#19), how an excerpt is cut from its page, and how the course
// glossary grows. The lesson builder checks the model's lesson against the rules; a broken rule is
// told in English, for the model's retry. No learner sees one: a lesson that breaks a rule is not
// shown.

import type { GlossaryEntry, Lesson, LessonDraft, Resource } from "../../../../contracts/index.ts";
import { contentHash } from "../../store/store.ts";

// A resource the lesson draws on, with the page text the page fetcher read from it.
export type Source = { id: string; lang: Resource["lang"]; text: string };

export const EXCERPT_WORDS = { min: 15, max: 300 };
export const MIN_SECTIONS = 3;
export const MIN_TERMS = 5;

// A page's text as sentences, the units an excerpt quotes. A heading or menu with no full stop
// joins the sentence after it.
export const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|(?<=[。！？])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

// Sentences first to last of the page, counted from 1, without footnote marks, edit links or the
// space the page fetcher leaves where a tag closed; undefined for sentences the page lacks.
export function excerptOf(source: Source, first: number, last: number): string | undefined {
  const sentences = sentencesOf(source.text);
  if (!Number.isInteger(first) || !Number.isInteger(last)) return undefined;
  if (first < 1 || last < first || last > sentences.length) return undefined;
  return sentences
    .slice(first - 1, last)
    .join(" ")
    .replace(/\[[^\]]{0,40}\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

// A Chinese character counts as a word.
export const wordCount = (text: string) =>
  (text.match(CJK)?.length ?? 0) + text.replace(CJK, " ").split(/\s+/).filter(Boolean).length;

const TASHKEEL = /[ً-ْٰـ]/g;
const arabicWords = (text: string) =>
  text
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(/[أإآ]/g, "ا")
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);

// A glossary term's Arabic words without the article, so the term still matches after a prefix
// (بالجدول) or in its indefinite form (جدول).
const stems = (ar: string) => arabicWords(ar).map((word) => word.replace(/^ال/, ""));

// Latin or Cyrillic words outside brackets. An all-capitals word, such as a function name (SUM) or
// a cell (C10), may stand in Arabic text.
const foreignWords = (text: string) =>
  (text.replace(/\([^)]*\)/g, " ").match(/[\p{Script=Latin}\p{Script=Cyrillic}]+/gu) ?? []).filter(
    (word) => /\p{Ll}/u.test(word),
  );

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Where the text writes the source term in brackets, and the words just before each.
function bracketed(text: string, entry: GlossaryEntry): { before: string; words: string[] }[] {
  const term = escaped(entry.src.term.trim()).replace(/\s+/g, "\\s+");
  const length = stems(entry.ar).length;
  return [...text.matchAll(new RegExp(`\\(\\s*${term}\\s*\\)`, "giu"))].map((match) => {
    const before = text.slice(0, match.index).trim().split(/\s+/).slice(-length).join(" ");
    return { before, words: arabicWords(before) };
  });
}

const writesTerm = (words: string[], entry: GlossaryEntry) => {
  const want = stems(entry.ar);
  return words.length === want.length && want.every((stem, i) => words[i]?.endsWith(stem));
};

export function lessonViolations(lesson: Lesson, glossary: GlossaryEntry[]): string[] {
  const violations: string[] = [];
  if (lesson.sections.length < MIN_SECTIONS) {
    violations.push(
      `the lesson has ${lesson.sections.length} sections; a lesson has at least ${MIN_SECTIONS}`,
    );
  }
  if (glossary.length < MIN_TERMS) {
    violations.push(
      `the lesson has ${glossary.length} glossary terms; a lesson has at least ${MIN_TERMS}`,
    );
  }

  lesson.sections.forEach(({ source_excerpt: excerpt, arabic }, i) => {
    const name = `section ${i + 1}`;
    const words = wordCount(excerpt.text);
    if (words > EXCERPT_WORDS.max) {
      violations.push(
        `${name}'s excerpt has ${words} words; an excerpt has at most ${EXCERPT_WORDS.max}`,
      );
    }
    if (words < EXCERPT_WORDS.min) {
      violations.push(
        `${name}'s excerpt has ${words} words; an excerpt has at least ${EXCERPT_WORDS.min}`,
      );
    }
    const foreign = foreignWords(arabic);
    if (foreign.length) {
      violations.push(
        `${name}'s explanation has words in another script outside brackets: ${foreign.map((w) => `"${w}"`).join(", ")}`,
      );
    }
  });

  // Each glossary term is written in the text as its Arabic term with the source term in brackets,
  // and always after that same Arabic term.
  const text = lesson.sections.map((s) => s.arabic).join("\n");
  const quoted = [...new Set(lesson.sections.map((s) => s.source_excerpt.lang))].sort();
  for (const entry of glossary) {
    // The bracketed term is the one the learner sees in the excerpt beside it.
    if (!quoted.includes(entry.src.lang)) {
      violations.push(
        `the glossary term "${entry.src.term}" is in ${entry.src.lang}, but the lesson quotes ${quoted.join(", ")}`,
      );
    }
    const uses = bracketed(text, entry);
    if (!uses.length) {
      violations.push(
        `the glossary term "${entry.src.term}" is not in the lesson's text as ${entry.ar} (${entry.src.term})`,
      );
    }
    for (const use of uses.filter((u) => !writesTerm(u.words, entry))) {
      violations.push(
        `the text writes (${entry.src.term}) after «${use.before}», not after its glossary term ${entry.ar}`,
      );
    }
  }
  return violations;
}

type DraftTerm = LessonDraft["glossary"][number];

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
const termKey = (lang: string, term: string) =>
  `${lang}:${tidy(term.normalize("NFKC")).toLowerCase()}`;

// The lesson's glossary entries, in the draft's order. A source term the course already has keeps
// its entry, so the same source term always has the same Arabic term.
export function mergeGlossary(known: GlossaryEntry[], drafted: DraftTerm[]): GlossaryEntry[] {
  const byKey = new Map(known.map((e) => [termKey(e.src.lang, e.src.term), e]));
  const lesson = new Map<string, GlossaryEntry>();
  for (const term of drafted) {
    const key = termKey(term.lang, term.term);
    if (lesson.has(key)) continue;
    lesson.set(
      key,
      byKey.get(key) ?? {
        id: `g_${contentHash(key)}`,
        ar: tidy(term.ar),
        ar_diacritized: tidy(term.ar_diacritized),
        src: { lang: term.lang, term: tidy(term.term) },
        definition_ar: term.definition_ar.trim(),
        example_ar: term.example_ar.trim(),
      },
    );
  }
  return [...lesson.values()];
}
