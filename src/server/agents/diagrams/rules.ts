import type { DiagramLabels } from "../../../../contracts/index.ts";

type Label = Pick<DiagramLabels["labels"][number], "src" | "ar">;

// Spark's transcripts sometimes read a dotted final ي as ى, or a final ة as ه.
const FOLD: Record<string, string> = {
  ى: "ي",
  ة: "ه",
  "\u066A": "%",
  "\u066B": ".",
  "\u066C": ",",
};
for (let d = 0; d < 10; d++) {
  FOLD[String.fromCharCode(0x0660 + d)] = String(d);
  FOLD[String.fromCharCode(0x06f0 + d)] = String(d);
}
const TASHKEEL_AND_TATWEEL = /[\u064B-\u0652\u0640]/g;
const folded = (text: string) =>
  text
    .normalize("NFC")
    .replace(TASHKEEL_AND_TATWEEL, "")
    .replace(/[ىة\u0660-\u066C\u06F0-\u06F9]/g, (c) => FOLD[c] ?? c)
    .toLowerCase();

const WORD_BREAK = /[^\p{L}\p{N}]+/u;
export const wordsOf = (text: string) => folded(text).split(WORD_BREAK).filter(Boolean);
const writtenWords = (text: string) => text.normalize("NFC").split(WORD_BREAK).filter(Boolean);

const isForeignWord = (word: string) =>
  /^\p{L}{2,}$/u.test(word) && !/\p{Script=Arabic}/u.test(word);
const isAcronym = (word: string) => word === word.toUpperCase() && word !== word.toLowerCase();
// What the reading prompt asks Spark to translate: words, but not numbers, single letters or
// acronyms.
const needsArabic = (text: string) =>
  writtenWords(text).some((w) => isForeignWord(w) && !isAcronym(w));

function occurrences(hay: string[], needle: string[]): number {
  if (!needle.length) return 0;
  let count = 0;
  for (let i = 0; i + needle.length <= hay.length; ) {
    if (needle.every((w, j) => hay[i + j] === w)) {
      count++;
      i += needle.length;
    } else i++;
  }
  return count;
}

const NUMBER = /\d+(?:[.,/:]\d+)*/g;

function tally<T>(items: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

const numbersOf = (texts: string[]) => texts.flatMap((t) => folded(t).match(NUMBER) ?? []);

// The numbers the relabelled image should hold: the source's, with each label's own numbers
// replaced by those of its Arabic.
function expectedNumbers(source: string[], labels: Label[]): Map<string, number> {
  const expected = tally(numbersOf(source));
  for (const n of numbersOf(labels.map((l) => l.src))) expected.set(n, (expected.get(n) ?? 0) - 1);
  for (const n of numbersOf(labels.map((l) => l.ar))) expected.set(n, (expected.get(n) ?? 0) + 1);
  return expected;
}

const keptAsWritten = ({ src, ar }: Label) =>
  occurrences(wordsOf(ar), wordsOf(src)) > 0 || !wordsOf(src).some((w) => /\p{L}/u.test(w));

// How many times each Arabic label appears, each word of a block counted for one label only, the
// longest labels first: «المجموع» does not count inside «المجموع الكلي».
function arabicCounts(labels: Label[], blocks: string[][]): Map<string, number> {
  const used = blocks.map((block) => block.map(() => false));
  const counts = new Map<string, number>();
  const ars = [...new Set(labels.map((l) => l.ar.trim()))];
  for (const ar of ars.toSorted((a, b) => wordsOf(b).length - wordsOf(a).length)) {
    const needle = wordsOf(ar);
    let count = 0;
    blocks.forEach((block, k) => {
      const free = used[k] ?? [];
      for (let i = 0; needle.length && i + needle.length <= block.length; ) {
        if (needle.every((w, j) => !free[i + j] && block[i + j] === w)) {
          needle.forEach((_, j) => {
            free[i + j] = true;
          });
          count++;
          i += needle.length;
        } else i++;
      }
    });
    counts.set(ar, count);
  }
  return counts;
}

// Spark transcribes the source and the relabelled image; it never judges them (spike #9: as a
// judge it rejected half the good samples).
export function relabelProblems(labels: Label[], source: string[], relabelled: string[]): string[] {
  const blocks = relabelled.map(wordsOf);
  const found = (words: string[]) => blocks.reduce((n, block) => n + occurrences(block, words), 0);
  const problems: string[] = [];

  const counts = arabicCounts(labels, blocks);
  for (const [ar, wanted] of tally(labels.map((l) => l.ar.trim()))) {
    const seen = counts.get(ar) ?? 0;
    if (seen < wanted) problems.push(`the Arabic label "${ar}" appears ${seen} of ${wanted} times`);
  }

  const left = new Set<string>();
  for (const label of labels) {
    if (!keptAsWritten(label) && found(wordsOf(label.src))) left.add(label.src.trim());
  }
  // A text Spark's reading missed was never sent to Muse Image, so it is still in the image.
  const listed = new Set(labels.map((l) => wordsOf(l.src).join(" ")));
  const shown = new Set(blocks.map((block) => block.join(" ")));
  for (const text of source) {
    const words = wordsOf(text).join(" ");
    if (needsArabic(text) && !listed.has(words) && shown.has(words)) left.add(text.trim());
  }
  for (const src of left) problems.push(`the source text "${src}" is still there`);

  const known = new Set([...source, ...labels.map((l) => l.ar)].flatMap(wordsOf));
  for (const text of new Set(relabelled.map((t) => t.trim()))) {
    if (writtenWords(text).some((w) => isForeignWord(w) && !known.has(folded(w)))) {
      problems.push(`the text "${text}" is not in the source`);
    }
  }

  const expected = expectedNumbers(source, labels);
  const got = tally(numbersOf(relabelled));
  for (const n of new Set([...expected.keys(), ...got.keys()])) {
    const want = Math.max(0, expected.get(n) ?? 0);
    const have = got.get(n) ?? 0;
    if (have !== want) problems.push(`the number ${n} appears ${have} times, not ${want}`);
  }
  return problems;
}

export type GlossaryTerm = { term: string; ar: string };

const ARTICLE = "ال";
const withAndWithoutArticle = (ar: string) => {
  const words = wordsOf(ar);
  const bare = words.map((w) =>
    w.startsWith(ARTICLE) && w.length > ARTICLE.length + 1 ? w.slice(ARTICLE.length) : w,
  );
  return [words, bare, bare.map((w) => `${ARTICLE}${w}`)];
};

export function glossaryProblems(labels: Label[], glossary: GlossaryTerm[]): string[] {
  const problems: string[] = [];
  for (const { src, ar } of labels) {
    for (const entry of glossary) {
      if (!occurrences(wordsOf(src), wordsOf(entry.term))) continue;
      if (withAndWithoutArticle(entry.ar).some((form) => occurrences(wordsOf(ar), form))) continue;
      problems.push(
        `"${src.trim()}" holds the glossary term "${entry.term}": write it «${entry.ar}»`,
      );
    }
  }
  return problems;
}

// MediaWiki's page text puts edit links after each heading, and a locator copied from it keeps
// them: "[ edit ]", "[ править | править код ]".
const headingKey = (heading: string) => wordsOf(heading.replace(/\[[^\]]*\]/g, " ")).join(" ");

export type PageFigures<F> = {
  sections: { index: number; heading: string }[];
  figures: (F & { heading: string })[];
};

export function rankFigures<F>(pages: PageFigures<F>[]): (F & { section: number })[] {
  const ranked = pages.flatMap((page, p) =>
    page.figures.map((figure, i) => {
      const quoted = page.sections.find(
        (s) => headingKey(s.heading) !== "" && headingKey(s.heading) === headingKey(figure.heading),
      );
      const first = page.sections[0]?.index ?? 0;
      return {
        figure: { ...figure, section: quoted?.index ?? first },
        unquoted: quoted ? 0 : 1,
        place: quoted ? quoted.index : p,
        onPage: i,
      };
    }),
  );
  ranked.sort((a, b) => a.unquoted - b.unquoted || a.place - b.place || a.onPage - b.onPage);
  return ranked.map((r) => r.figure);
}

export type ImageHeader = {
  mime: "image/png" | "image/gif" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
};

// The type and size an image's bytes declare, whatever a server said its type was.
export function imageHeader(bytes: Uint8Array): ImageHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  const sized = (mime: ImageHeader["mime"], width: number, height: number) =>
    width && height ? { mime, width, height } : null;
  if (bytes.length < 30) return null;
  if (ascii(1, 3) === "PNG") return sized("image/png", view.getUint32(16), view.getUint32(20));
  if (ascii(0, 3) === "GIF") {
    return sized("image/gif", view.getUint16(6, true), view.getUint16(8, true));
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const size = (width: number, height: number) => sized("image/webp", width, height);
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") {
      return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") {
      const u24 = (at: number) => view.getUint16(at, true) + (view.getUint8(at + 2) << 16);
      return size(u24(24) + 1, u24(27) + 1);
    }
    return null;
  }
  // A JPEG: walk its segments to the start of frame, which holds the size.
  if (view.getUint16(0) !== 0xffd8) return null;
  for (let at = 2; at + 9 < bytes.length; ) {
    if (view.getUint8(at) !== 0xff) return null;
    const marker = view.getUint8(at + 1);
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) return sized("image/jpeg", view.getUint16(at + 7), view.getUint16(at + 5));
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}
