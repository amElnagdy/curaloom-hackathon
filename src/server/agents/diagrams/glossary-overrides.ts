// Approved Arabic for source texts the diagram_labels reading translates wrong (#38, #44). The
// table is code, not prompt: a prompt change re-hashes the recorded requests and forces a
// re-record. It changes only what the diagram shows; the edit and the check keep the reading.

import type { GlossaryEntry } from "../../../../contracts/index.ts";
import { wordsOf } from "./rules.ts";

export type GlossaryOverride = {
  term: string;
  lang: GlossaryEntry["src"]["lang"];
  ar: string;
};

export const GLOSSARY_OVERRIDES: readonly GlossaryOverride[] = [
  { term: "BUZZ CUT", lang: "en", ar: "قَصّة شعر قصيرة" },
];

// A label whose Arabic the table replaced: what the reading gave and what the diagram shows.
export type Overridden = { src: string; model_ar: string; ar: string };

const termKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const APPROVED = new Map(GLOSSARY_OVERRIDES.map((o) => [termKey(o.term), o.ar]));

// Diacritics and tatweel aside, as the code check reads Arabic.
const sameArabic = (a: string, b: string) => wordsOf(a).join(" ") === wordsOf(b).join(" ");

// The labels with the table's Arabic wherever it names a label's source text and the reading's
// Arabic differs, and each replacement made.
export function overrideLabels<L extends { src: string; ar: string }>(
  labels: L[],
): { labels: L[]; overridden: Overridden[] } {
  const overridden: Overridden[] = [];
  const shown = labels.map((label) => {
    const ar = APPROVED.get(termKey(label.src));
    if (ar === undefined || sameArabic(label.ar, ar)) return label;
    overridden.push({ src: label.src, model_ar: label.ar, ar });
    return { ...label, ar };
  });
  return { labels: shown, overridden };
}

// The replacements, one per distinct term, for the trace and the check's problems.
export function overridesNote(overridden: Overridden[]): { ar: string; en: string } {
  const unique = (lines: string[]) => [...new Set(lines)];
  return {
    // The Arabic line leaves the source text to the English one (#59).
    ar: unique(overridden.map((o) => `من «${o.model_ar.trim()}» إلى «${o.ar}»`)).join("، و"),
    en: unique(
      overridden.map(
        (o) => `"${o.src.trim()}" from «${o.model_ar.trim()}» to the approved «${o.ar}»`,
      ),
    ).join("; "),
  };
}
