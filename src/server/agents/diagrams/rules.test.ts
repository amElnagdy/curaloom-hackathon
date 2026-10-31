import { describe, expect, it } from "vitest";
import { glossaryProblems, imageHeader, rankFigures, relabelProblems } from "./rules.ts";

const label = (src: string, ar: string) => ({ src, ar, box: [0, 0, 10, 10] });

const SOURCE = [
  "Sum of Units",
  "Ship Date",
  "Region",
  "1/31/2005",
  "East",
  "66",
  "Grand Total",
  "363",
];
const LABELS = [
  label("Sum of Units", "مجموع الوحدات"),
  label("Ship Date", "تاريخ الشحن"),
  label("Region", "المنطقة"),
  label("East", "الشرق"),
  label("Grand Total", "الإجمالي العام"),
];
const RELABELLED = [
  "مجموع الوحدات",
  "تاريخ الشحن",
  "المنطقة",
  "1/31/2005",
  "الشرق",
  "66",
  "الإجمالي العام",
  "363",
];

describe("the relabel check", () => {
  it("passes a sample with every Arabic label, no source label and the same numbers", () => {
    expect(relabelProblems(LABELS, SOURCE, RELABELLED)).toEqual([]);
  });

  it("reads a final ى as ي, and ignores tashkeel, tatweel and Arabic-Indic digits", () => {
    const read = RELABELLED.map((t) =>
      t.replace("الشرق", "الشَّرق").replace("تاريخ", "تـاريخ").replace("66", "٦٦"),
    );
    const labels = [...LABELS, label("Other", "أخرى")];

    expect(relabelProblems(labels, SOURCE, [...read, "أخري"])).toEqual([]);
  });

  it("reads a final ة written as ه, and the Arabic decimal point and percent sign", () => {
    const labels = [label("Short story", "قصة قصيرة"), label("Sales tax 9.75%", "ضريبة 9.75%")];

    expect(
      relabelProblems(labels, ["Short story", "Sales tax 9.75%"], ["قصه قصيرة", "ضريبة ٩٫٧٥٪"]),
    ).toEqual([]);
  });

  it("finds an Arabic label missing, a source label left, and a number doubled", () => {
    const sample = RELABELLED.map((t) => (t === "الشرق" ? "East" : t));

    expect(relabelProblems(LABELS, SOURCE, [...sample, "363"])).toEqual([
      'the Arabic label "الشرق" appears 0 of 1 times',
      'the source text "East" is still there',
      "the number 363 appears 2 times, not 1",
    ]);
  });

  it("matches a label as whole words in one text block, not inside a longer one", () => {
    const labels = [label("Total", "المجموع")];

    expect(relabelProblems(labels, ["Total", "Totals"], ["المجموع", "Totals"])).toEqual([
      'the source text "Totals" is still there',
    ]);
    expect(relabelProblems(labels, ["Total"], ["المجموعة"])).toEqual([
      'the Arabic label "المجموع" appears 0 of 1 times',
    ]);
  });

  it("moves a label's own numbers with it, and keeps a label written as it is", () => {
    const labels = [label("Q1 sales", "مبيعات الربع 1"), label("VisiCalc", "VisiCalc")];

    expect(
      relabelProblems(labels, ["Q1 sales", "VisiCalc"], ["مبيعات الربع 1", "VisiCalc"]),
    ).toEqual([]);
  });

  it("counts each word of a block for one label, so a short label is not found in a longer one", () => {
    const labels = [label("Total", "المجموع"), label("Grand Total", "المجموع الكلي")];

    expect(
      relabelProblems(labels, ["Total", "Grand Total", "66"], ["المجموع الكلي", "66"]),
    ).toEqual(['the Arabic label "المجموع" appears 0 of 1 times']);
  });

  it("finds a text the reading missed still in the image, and a text the source does not have", () => {
    const labels = [label("Sum of Units", "مجموع الوحدات")];
    const source = ["Sum of Units", "Region", "ETL", "66"];

    expect(
      relabelProblems(labels, source, ["مجموع الوحدات", "Region", "ETL", "Regoin Totl", "66"]),
    ).toEqual([
      'the source text "Region" is still there',
      'the text "Regoin Totl" is not in the source',
    ]);
  });

  it("counts a label that appears in several cells once per cell", () => {
    const labels = [label("North", "الشمال"), label("North", "الشمال")];

    expect(relabelProblems(labels, ["North", "North"], ["الشمال", "North"])).toEqual([
      'the Arabic label "الشمال" appears 1 of 2 times',
      'the source text "North" is still there',
    ]);
  });
});

describe("the glossary check", () => {
  const glossary = [
    { term: "pivot table", ar: "جدول محوري" },
    { term: "sum", ar: "مجموع" },
  ];

  it("accepts a label that writes a glossary term as the glossary does, with or without the article", () => {
    const labels = [label("Pivot Table", "الجدول المحوري"), label("Sum of Units", "مجموع الوحدات")];

    expect(glossaryProblems(labels, glossary)).toEqual([]);
  });

  it("names a label that translates a glossary term another way", () => {
    const labels = [label("Sum of Units", "إجمالي الوحدات"), label("Region", "المنطقة")];

    expect(glossaryProblems(labels, glossary)).toEqual([
      '"Sum of Units" holds the glossary term "sum": write it «مجموع»',
    ]);
  });
});

describe("the figures to try", () => {
  it("puts the figures under the headings the lesson quotes first, in its order, then the rest", () => {
    const pages = [
      {
        sections: [
          { index: 1, heading: "Fonctionnement [ modifier | modifier le code ]" },
          { index: 3, heading: "Graphiques" },
        ],
        figures: [
          { id: "logo", heading: "Sommaire" },
          { id: "chart", heading: "Graphiques" },
          { id: "cells", heading: "Fonctionnement" },
        ],
      },
      {
        sections: [{ index: 0, heading: "Origines" }],
        figures: [{ id: "visicalc", heading: "Origines" }],
      },
      { sections: [], figures: [{ id: "unquoted", heading: "Exemple" }] },
    ];

    expect(rankFigures(pages).map((f) => [f.id, f.section])).toEqual([
      ["visicalc", 0],
      ["cells", 1],
      ["chart", 3],
      ["logo", 1],
      ["unquoted", 0],
    ]);
  });
});

describe("an image's header", () => {
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(
      parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );
  const pad = (n: number) => Array(n).fill(0);

  it("reads the type and size of PNG, GIF, JPEG and the three WebP headers", () => {
    const png = bytes([0x89], "PNG", pad(8), "IHDR", [0, 0, 2, 0x2e, 0, 0, 0, 0x89], pad(10));
    const gif = bytes("GIF89a", [0x30, 0x02, 0x80, 0x01], pad(24));
    const jpeg = bytes(
      [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0],
      [0xff, 0xc0, 0, 17, 8, 1, 0x80, 2, 0x30],
      pad(20),
    );
    const webp = (chunk: string, body: number[]) =>
      bytes("RIFF", pad(4), "WEBP", chunk, body, pad(10));

    const webp560 = { mime: "image/webp", width: 560, height: 384 };

    expect(imageHeader(png)).toEqual({ mime: "image/png", width: 558, height: 137 });
    expect(imageHeader(gif)).toEqual({ mime: "image/gif", width: 560, height: 384 });
    expect(imageHeader(jpeg)).toEqual({ mime: "image/jpeg", width: 560, height: 384 });
    expect(imageHeader(webp("VP8X", [...pad(8), 0x6f, 0x0b, 0, 0xcf, 0x02, 0]))).toEqual({
      mime: "image/webp",
      width: 2928,
      height: 720,
    });
    expect(imageHeader(webp("VP8 ", [...pad(10), 0x30, 0x02, 0x80, 0x01]))).toEqual(webp560);
    expect(imageHeader(webp("VP8L", [...pad(4), 0x2f, 0x2f, 0xc2, 0x5f, 0x00]))).toEqual(webp560);
    expect(imageHeader(bytes("<svg>", pad(40)))).toBeNull();
  });
});
