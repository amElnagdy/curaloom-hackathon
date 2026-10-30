import { describe, expect, it } from "vitest";
import type { GlossaryEntry, Lesson, LessonDraft } from "../../../../contracts/index.ts";
import { excerptOf, lessonViolations, mergeGlossary, type Source } from "./rules.ts";

// Page text as the page fetcher keeps it: one line, with footnote marks, edit links and a space
// before a punctuation mark where a tag closed.
const [FR, EN] = [
  {
    id: "r_fr",
    lang: "fr",
    text: "Tableau croisé dynamique — Wikipédia Aller au contenu Menu principal Un tableau croisé dynamique [1] (en anglais pivot table ) est un outil de synthèse des données d'une table , qui permet de regrouper , trier et compter les valeurs . Principe [ modifier | modifier le code ] Le tableau croisé dynamique regroupe les lignes de la table source selon les valeurs d'une ou plusieurs colonnes , puis calcule pour chaque groupe une somme , une moyenne ou un nombre de lignes . L'utilisateur choisit les champs à placer en lignes , en colonnes et en valeurs .",
  },
  {
    id: "r_en",
    lang: "en",
    text: "Pivot table - Wikipedia Jump to content A pivot table is a table of values which are aggregations of groups of individual values from a more extensive table (such as from a database , spreadsheet , or business intelligence program) within one or more discrete categories. [1] History [ edit ]",
  },
] as Source[];

type Section = Lesson["sections"][number];
const section = (resource_id: string, text: string, arabic: string): Section => ({
  source_excerpt: {
    lang: resource_id === "r_en" ? "en" : "fr",
    text,
    resource_id,
    locator: "Principe",
  },
  arabic,
  notes_ar: "جرّب ذلك على كشف حساب من عملك.",
});

const LESSON: Lesson = {
  id: "L1",
  title_ar: "ما الجدول المحوري",
  objectives_ar: ["تعرف ما الجدول المحوري"],
  sections: [
    section(
      "r_fr",
      "Un tableau croisé dynamique (en anglais pivot table) est un outil de synthèse des données d'une table, qui permet de regrouper, trier et compter les valeurs.",
      "الجدول المحوري (tableau croisé dynamique) أداة تلخّص بيانات جدول كبير، فتجمع صفوفه وترتبها وتعدّها.",
    ),
    section(
      "r_fr",
      "Le tableau croisé dynamique regroupe les lignes de la table source selon les valeurs d'une ou plusieurs colonnes, puis calcule pour chaque groupe une somme, une moyenne ou un nombre de lignes.",
      "يجمع الجدول المحوري الصفوف حسب قيمة الحقل (champ) الذي تختاره، ثم يحسب لكل مجموعة المجموع (somme) أو المتوسط (moyenne).",
    ),
    section(
      "r_en",
      "A pivot table is a table of values which are aggregations of groups of individual values from a more extensive table (such as from a database, spreadsheet, or business intelligence program) within one or more discrete categories.",
      "الجدول المحوري (pivot table) جدول قيم، كل قيمة فيه تجميع (aggregation) لمجموعة من القيم في جدول أكبر.",
    ),
  ],
  glossary_ids: ["g1", "g2", "g3", "g4", "g5", "g6"],
};

const entry = (id: string, lang: "en" | "fr" | "ru", term: string, ar: string): GlossaryEntry => ({
  id,
  ar,
  ar_diacritized: ar,
  src: { lang, term },
  definition_ar: "تعريف قصير.",
  example_ar: "مثال قصير.",
});

const GLOSSARY: GlossaryEntry[] = [
  entry("g1", "fr", "tableau croisé dynamique", "الجدول المحوري"),
  entry("g2", "fr", "champ", "الحقل"),
  entry("g3", "fr", "somme", "المجموع"),
  entry("g4", "fr", "moyenne", "المتوسط"),
  entry("g5", "en", "aggregation", "التجميع"),
  entry("g6", "en", "pivot table", "الجدول المحوري"),
];

const withSection = (index: number, change: Partial<Section>): Lesson => ({
  ...LESSON,
  sections: LESSON.sections.map((s, i) => (i === index ? { ...s, ...change } : s)),
});
const withExcerpt = (index: number, text: string): Lesson => {
  const s = LESSON.sections[index] as Section;
  return withSection(index, { source_excerpt: { ...s.source_excerpt, text } });
};

describe("excerptOf", () => {
  it("quotes the numbered sentences without the page's footnote marks, edit links and stray spaces", () => {
    expect(excerptOf(FR as Source, 2, 3)).toBe(
      "Principe Le tableau croisé dynamique regroupe les lignes de la table source selon les valeurs d'une ou plusieurs colonnes, puis calcule pour chaque groupe une somme, une moyenne ou un nombre de lignes. L'utilisateur choisit les champs à placer en lignes, en colonnes et en valeurs.",
    );
    expect(excerptOf(EN as Source, 1, 1)).toMatch(
      /\(such as from a database, spreadsheet, .*categories\.$/,
    );
  });

  it("ends a Chinese sentence at its full stop", () => {
    const zh: Source = { id: "r_zh", lang: "zh", text: "数据透视表是一种表格。它可以汇总数据。" };

    expect(excerptOf(zh, 2, 2)).toBe("它可以汇总数据。");
  });

  it.each([
    [0, 1],
    [2, 1],
    [3, 4],
    [1.5, 2],
  ])("has nothing for sentences %d to %d, which the page lacks", (first, last) => {
    expect(excerptOf(FR as Source, first, last)).toBeUndefined();
  });
});

describe("lessonViolations", () => {
  it("finds nothing wrong with a lesson that keeps every rule", () => {
    expect(lessonViolations(LESSON, GLOSSARY)).toEqual([]);
  });

  it("accepts a function name or a cell in an explanation, and any word in brackets", () => {
    const arabic = `${(LESSON.sections[0] as Section).arabic} اكتب =SUM(B2:B9) في الخلية C10، أو احفظ الملف بصيغة CSV (comma-separated values).`;

    expect(lessonViolations(withSection(0, { arabic }), GLOSSARY)).toEqual([]);
  });

  it.each([
    ["with an attached prefix", "ابدأ بالجدول المحوري (tableau croisé dynamique) الآن."],
    ["without its article", "هذا جدول محوري (tableau croisé dynamique) صغير."],
    ["with its source term capitalised", "الجدول المحوري (Tableau Croisé Dynamique) أداة."],
    ["with tashkeel", "الجَدْوَلُ المِحْوَرِيُّ (tableau croisé dynamique) أداة."],
  ])("accepts a glossary term written %s", (_, arabic) => {
    expect(lessonViolations(withSection(0, { arabic }), GLOSSARY)).toEqual([]);
  });

  it.each([
    [
      "an excerpt longer than 300 words",
      withExcerpt(0, "valeurs ".repeat(301)),
      GLOSSARY,
      /section 1.*301 words.*at most 300/,
    ],
    [
      "an excerpt too short to teach from",
      withExcerpt(0, "Le tableau croisé dynamique"),
      GLOSSARY,
      /section 1.*4 words.*at least 15/,
    ],
    [
      "fewer than three sections",
      { ...LESSON, sections: LESSON.sections.slice(0, 2) },
      GLOSSARY.slice(0, 5),
      /2 sections.*at least 3/,
    ],
    [
      "fewer than five glossary terms",
      LESSON,
      GLOSSARY.slice(0, 4),
      /4 glossary terms.*at least 5/,
    ],
    [
      "a glossary term the text never writes",
      withSection(1, {
        arabic: "يجمع الجدول المحوري الصفوف حسب الحقل (champ) ويحسب المجموع (somme).",
      }),
      GLOSSARY,
      /moyenne.*not in the lesson's text/,
    ],
    [
      "a glossary term written after another Arabic term",
      withSection(0, { arabic: "الجدول الديناميكي (tableau croisé dynamique) أداة تلخيص." }),
      GLOSSARY,
      /\(tableau croisé dynamique\) after .*الجدول الديناميكي.*not.*الجدول المحوري/,
    ],
    // A reply Spark once gave: an English lesson that kept the French term from an earlier one.
    [
      "a glossary term in a language the lesson does not quote",
      withSection(2, {
        arabic: `${(LESSON.sections[2] as Section).arabic} وفي الروسية جدول محوري (сводная таблица).`,
      }),
      [...GLOSSARY, entry("g7", "ru", "сводная таблица", "الجدول المحوري")],
      /"сводная таблица" is in ru.*quotes en, fr/,
    ],
    // A reply Spark once gave.
    [
      "a foreign word outside brackets in an explanation",
      withSection(1, {
        arabic: `${(LESSON.sections[1] as Section).arabic} تخيل كم verbose: أنت كمحاسب تجمع القيود.`,
      }),
      GLOSSARY,
      /section 2's explanation has.*"verbose"/,
    ],
  ])("catches %s", (_, lesson, glossary, en) => {
    expect(lessonViolations(lesson, glossary)).toContainEqual(expect.stringMatching(en));
  });
});

type DraftTerm = LessonDraft["glossary"][number];
const drafted = (lang: "en" | "fr", term: string, ar: string): DraftTerm => ({
  lang,
  term,
  ar,
  ar_diacritized: ar,
  definition_ar: "تعريف.",
  example_ar: "مثال.",
});

describe("mergeGlossary", () => {
  it("keeps a known source term's entry, whatever Arabic the draft gives it", () => {
    const known = GLOSSARY.slice(0, 1);

    const merged = mergeGlossary(known, [
      drafted("fr", " Tableau croisé  dynamique", "الجدول الديناميكي"),
    ]);

    expect(merged).toEqual(known);
  });

  it("adds a new term once, even when the draft repeats it", () => {
    const merged = mergeGlossary(
      [],
      [drafted("fr", "champ", "الحقل"), drafted("fr", "champ", "المجال")],
    );

    expect(merged).toEqual([
      {
        id: expect.any(String),
        ar: "الحقل",
        ar_diacritized: "الحقل",
        src: { lang: "fr", term: "champ" },
        definition_ar: "تعريف.",
        example_ar: "مثال.",
      },
    ]);
  });

  it("gives the next lesson the entry an earlier lesson added", () => {
    const first = mergeGlossary([], [drafted("fr", "champ", "الحقل")]);

    const next = mergeGlossary(first, [
      drafted("fr", "Champ", "المجال"),
      drafted("en", "field", "الحقل"),
    ]);

    expect(next.map((e) => [e.id, e.ar, e.src.term])).toEqual([
      [first[0]?.id, "الحقل", "champ"],
      [expect.not.stringMatching(first[0]?.id ?? ""), "الحقل", "field"],
    ]);
  });
});
