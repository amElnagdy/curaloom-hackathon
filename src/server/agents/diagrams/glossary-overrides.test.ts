import { describe, expect, it } from "vitest";
import { overrideLabels, overridesNote } from "./glossary-overrides.ts";

describe("the glossary override table", () => {
  it("replaces the reading's Arabic for a term it names, however the source text is spaced or cased", () => {
    const { labels, overridden } = overrideLabels([
      { src: " buzz  cut ", ar: "قصة قصيرة", box: [1, 2, 3, 4] },
      { src: "BUZZ CUT", ar: "قصة قصيرة", box: [5, 6, 7, 8] },
    ]);

    expect(labels).toEqual([
      { src: " buzz  cut ", ar: "قَصّة شعر قصيرة", box: [1, 2, 3, 4] },
      { src: "BUZZ CUT", ar: "قَصّة شعر قصيرة", box: [5, 6, 7, 8] },
    ]);
    expect(overridden).toEqual([
      { src: " buzz  cut ", model_ar: "قصة قصيرة", ar: "قَصّة شعر قصيرة" },
      { src: "BUZZ CUT", model_ar: "قصة قصيرة", ar: "قَصّة شعر قصيرة" },
    ]);
    expect(overridesNote(overridden)).toEqual({
      ar: "«buzz  cut» من «قصة قصيرة» إلى «قَصّة شعر قصيرة»، «BUZZ CUT» من «قصة قصيرة» إلى «قَصّة شعر قصيرة»",
      en: '"buzz  cut" from «قصة قصيرة» to the approved «قَصّة شعر قصيرة»; "BUZZ CUT" from «قصة قصيرة» to the approved «قَصّة شعر قصيرة»',
    });
  });

  it("leaves a label it does not name, or one already in the approved Arabic, as the reading gave it", () => {
    const given = [
      { src: "MUCK RAKE", ar: "مذراة طين" },
      { src: "BUZZ CUT", ar: "قَصّة شعر قصيرة" },
      { src: "BUZZ CUTTER", ar: "قصة قصيرة" },
    ];

    expect(overrideLabels(given)).toEqual({ labels: given, overridden: [] });
  });
});
