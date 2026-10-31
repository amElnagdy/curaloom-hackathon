// The diagram rules (#28), in code: which image a lesson tries first, whether Spark's Arabic labels
// keep the course glossary, and whether a relabelled image passes the text check. Spark transcribes
// the source and the relabelled image; it never judges them (spike #9: as a judge it rejected half
// the good samples).

import type { DiagramLabels } from "../../../../contracts/index.ts";

type Label = Pick<DiagramLabels["labels"][number], "src" | "ar">;

// Spark's transcripts sometimes read a dotted final ي as ى, or a final ة as ه. Matching ignores
// that, tashkeel and tatweel, and reads Arabic-Indic digits and the Arabic decimal point, thousands
// separator and percent sign as their ASCII forms.
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
const folded = (text: string) =>
  text
    .normalize("NFC")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[ىة\u0660-\u066C\u06F0-\u06F9]/g, (c) => FOLD[c] ?? c)
    .toLowerCase();

// A text as its words: letters and digits, folded. Punctuation and brackets do not count, so
// «(فارغ)» matches a transcript's «{فارغ}».
export const wordsOf = (text: string) =>
  folded(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

// How many times `needle` occurs as whole consecutive words in `hay`, without overlap.
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

// What is wrong with a relabelled image, from Spark's transcripts of the source and of the image,
// matched text block by text block so a short label cannot match inside a longer word: an Arabic
// label missing, a source label still there, or a number lost or added. A label's own numbers move
// with it, so a source label "Q1" translated without its 1 drops one 1 from what the image needs.
export function relabelProblems(labels: Label[], source: string[], relabelled: string[]): string[] {
  const blocks = relabelled.map(wordsOf);
  const found = (words: string[]) => blocks.reduce((n, block) => n + occurrences(block, words), 0);
  const problems: string[] = [];

  for (const [ar, wanted] of tally(labels.map((l) => l.ar.trim()))) {
    const seen = found(wordsOf(ar));
    if (seen < wanted) problems.push(`the Arabic label "${ar}" appears ${seen} of ${wanted} times`);
  }
  const left = new Set<string>();
  for (const { src, ar } of labels) {
    const words = wordsOf(src);
    // A label kept as written, such as a name in Latin letters, is not left over.
    if (occurrences(wordsOf(ar), words) || !words.some((w) => /\p{L}/u.test(w))) continue;
    if (found(words)) left.add(src.trim());
  }
  for (const src of left) problems.push(`the source text "${src}" is still there`);

  const expected = tally(numbersOf(source));
  for (const n of numbersOf(labels.map((l) => l.src))) expected.set(n, (expected.get(n) ?? 0) - 1);
  for (const n of numbersOf(labels.map((l) => l.ar))) expected.set(n, (expected.get(n) ?? 0) + 1);
  const got = tally(numbersOf(relabelled));
  for (const n of new Set([...expected.keys(), ...got.keys()])) {
    const want = Math.max(0, expected.get(n) ?? 0);
    const have = got.get(n) ?? 0;
    if (have !== want) problems.push(`the number ${n} appears ${have} times, not ${want}`);
  }
  return problems;
}

export type GlossaryTerm = { term: string; ar: string };

// The Arabic forms of a glossary term a label may use: as the glossary writes it, and with or
// without the article on each word ("جدول محوري", "الجدول المحوري").
const formsOf = (ar: string) => {
  const words = wordsOf(ar);
  const bare = words.map((w) => (w.startsWith("ال") && w.length > 3 ? w.slice(2) : w));
  return [words, bare, bare.map((w) => `ال${w}`)];
};

// A label that holds a glossary term must use the glossary's Arabic for it, so a term reads the same
// in the lesson and in its diagrams. Spark is told the glossary; code checks it kept it.
export function glossaryProblems(labels: Label[], glossary: GlossaryTerm[]): string[] {
  const problems: string[] = [];
  for (const { src, ar } of labels) {
    for (const entry of glossary) {
      if (!occurrences(wordsOf(src), wordsOf(entry.term))) continue;
      if (formsOf(entry.ar).some((form) => occurrences(wordsOf(ar), form))) continue;
      problems.push(
        `"${src.trim()}" holds the glossary term "${entry.term}": write it «${entry.ar}»`,
      );
    }
  }
  return problems;
}

// A heading as the lesson's locator and the page's markup both write it: without the edit links
// the page text puts after it ("[ edit ]", "[ править | править код ]").
const headingKey = (heading: string) => wordsOf(heading.replace(/\[[^\]]*\]/g, " ")).join(" ");

export type PageFigures<F> = {
  // The lesson sections quoting the page: their index and the heading each quotes under.
  sections: { index: number; heading: string }[];
  figures: (F & { heading: string })[];
};

// The images to try, best first: each under a heading the lesson quotes, in the order the lesson
// quotes them, then the rest of the quoted pages' images in page order. Each comes with the section
// it illustrates.
export function rankFigures<F>(pages: PageFigures<F>[]): (F & { section: number })[] {
  const ranked = pages.flatMap((page, p) =>
    page.figures.map((figure, i) => {
      const quoted = page.sections.find(
        (s) => headingKey(s.heading) !== "" && headingKey(s.heading) === headingKey(figure.heading),
      );
      const first = page.sections[0]?.index ?? 0;
      return {
        figure: { ...figure, section: quoted?.index ?? first },
        under: quoted ? 0 : 1,
        order: quoted?.index ?? p,
        at: i,
      };
    }),
  );
  ranked.sort((a, b) => a.under - b.under || a.order - b.order || a.at - b.at);
  return ranked.map((r) => r.figure);
}

// An image's size in pixels from its header, for the four types the page fetcher accepts and the
// WebP Muse Image returns; null for anything else.
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  const size = (width: number, height: number) => (width && height ? { width, height } : null);
  if (bytes.length < 30) return null;
  if (ascii(1, 3) === "PNG") return size(view.getUint32(16), view.getUint32(20));
  if (ascii(0, 3) === "GIF") return size(view.getUint16(6, true), view.getUint16(8, true));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
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
    if (frame) return size(view.getUint16(at + 7), view.getUint16(at + 5));
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}
