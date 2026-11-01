import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DiagramLabels,
  GlossaryEntry,
  ImageTexts,
  Lesson,
} from "../../../../contracts/index.ts";
import { createOrchestrator, StepFailed } from "../../orchestrator/orchestrator.ts";
import type { ModelResult, Provider } from "../../providers/provider.ts";
import { createFileStore } from "../../store/store.ts";
import type { PageFetcher, PageView } from "../../tools/fetch-page.ts";
import type { TraceEvent } from "../../trace/trace.ts";
import { createDiagramsBuilder, diagramsBrief, LessonNotWritten } from "./diagrams.ts";
import { diagramImageResponse } from "./http.ts";
import type { Figure, FileInfo } from "./wiki.ts";

const PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
  0x49,
  0x48,
  0x44,
  0x52,
  0,
  0,
  2,
  0x2e,
  0,
  0,
  0,
  0x89,
  ...Array(10).fill(0),
]).toString("base64");
const webp = (sample: number) =>
  Buffer.concat([
    Buffer.from("RIFF\0\0\0\0WEBPVP8X"),
    Buffer.from([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x6f,
      0x0b,
      0,
      0xcf,
      0x02,
      0,
      sample,
      ...Array(9).fill(0),
    ]),
  ]).toString("base64");

const RU_PAGE = "https://ru.wikipedia.org/wiki/Сводная_таблица";
const EN_PAGE = "https://en.wikipedia.org/wiki/Pivot_table";
const PIVOTED = "https://commons.wikimedia.org/wiki/File:Pivottable-Pivoted.PNG";
const EXAMPLE = "https://commons.wikimedia.org/wiki/File:Pivot_table_example.svg";

const section = (resource_id: string, locator: string) => ({
  source_excerpt: { lang: "en" as const, text: "A pivot table…", resource_id, locator },
  arabic: "الجدول المحوري…",
  notes_ar: "",
});
const LESSON: Lesson = {
  id: "L2",
  title_ar: "ما الجدول المحوري",
  objectives_ar: [],
  sections: [section("r_en", "Mechanics"), section("r_en", "Implementation [ edit ]")],
  glossary_ids: ["g1"],
};
const GLOSSARY: GlossaryEntry[] = [
  {
    id: "g1",
    ar: "مجموع",
    ar_diacritized: "مَجْمُوع",
    src: { lang: "en", term: "sum" },
    definition_ar: "",
    example_ar: "",
  },
  {
    id: "g9",
    ar: "خلية",
    ar_diacritized: "خَلِيَّة",
    src: { lang: "en", term: "cell" },
    definition_ar: "",
    example_ar: "",
  },
];
const RESOURCES = [
  { id: "r_book", url: "https://example.org/pivot-tables" },
  { id: "r_ru", url: RU_PAGE },
  { id: "r_en", url: EN_PAGE },
];
const BRIEF = diagramsBrief(LESSON, RESOURCES, GLOSSARY);

const LABELS: DiagramLabels = {
  caption_ar: "جدول محوري يجمع الوحدات حسب المنطقة وتاريخ الشحن",
  labels: [
    { src: "Sum of Units", ar: "مجموع الوحدات", box: [100, 200, 300, 400] },
    { src: "Region", ar: "المنطقة", box: [0, 500, 100, 600] },
  ],
};
const SOURCE_TEXTS = ["Sum of Units", "Region", "1/31/2005", "66"];
const GOOD = ["مجموع الوحدات", "المنطقة", "1/31/2005", "66"];
const LEFT_OVER = ["مجموع الوحدات", "Region", "1/31/2005", "66"];
// A reading that gives "BUZZ CUT" as «قصة قصيرة» (a short story), which the override table corrects.
const HAIRCUT: DiagramLabels = {
  ...LABELS,
  labels: [...LABELS.labels, { src: "BUZZ CUT", ar: "قصة قصيرة", box: [0, 700, 100, 800] }],
};
const HAIRCUT_SOURCE = [...SOURCE_TEXTS, "BUZZ CUT"];
const HAIRCUT_GOOD = [...GOOD, "قصة قصيرة"];
const HAIRCUT_LEFT_OVER = [...LEFT_OVER, "قصة قصيرة"];

const file = (licences: string[]): FileInfo => ({
  licences,
  author: "Wikidan829 at English Wikipedia",
  image_url: "https://upload.wikimedia.org/wikipedia/commons/6/63/Pivottable-Pivoted.PNG",
  mime: "image/png",
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const result = <J>(json: J, image: ModelResult["image"] = null): ModelResult<J> => ({
  text: "",
  json,
  tool_calls: [],
  citations: [],
  image,
  usage: { in: 0, out: 0, cost_usd: 0 },
  latency_ms: 0,
  model: "fake",
});

const SHOWN: Record<string, Figure[]> = {
  [EN_PAGE]: [{ file_page: EXAMPLE, heading: "Implementation", width: 512, height: 576 }],
  [RU_PAGE]: [{ file_page: PIVOTED, heading: "Пример сводной таблицы", width: 558, height: 137 }],
};

type Script = {
  shown?: Record<string, Figure[]>;
  files?: Record<string, FileInfo>;
  readings?: DiagramLabels[];
  sourceTexts?: string[];
  samples?: string[][];
  // How many readings fail before one answers, and whether the source's transcript fails.
  failedReadings?: number;
  sourceFails?: boolean;
  // How many edits throw, then how many answer bytes code cannot read, before one answers; and
  // how many samples' transcripts throw before one answers.
  failedEdits?: number;
  unreadableEdits?: number;
  failedSamples?: number;
};

function setup({
  shown = SHOWN,
  files = { [PIVOTED]: file(["Public domain"]) },
  readings = [LABELS],
  sourceTexts = SOURCE_TEXTS,
  samples = [GOOD],
  failedReadings = 0,
  sourceFails = false,
  failedEdits = 0,
  unreadableEdits = 0,
  failedSamples = 0,
}: Script = {}) {
  const dir = mkdtempSync(join(tmpdir(), "diagrams-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const sent = { reads: [] as string[], edits: [] as string[], files: [] as string[] };
  let transcribed = 0;
  const promptOf = (input: unknown) =>
    JSON.stringify(input).match(/"input_text","text":"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
  const provider = {
    async structured(call: { schema: { name: string }; input: unknown }) {
      if (call.schema.name === "DiagramLabels") {
        sent.reads.push(JSON.parse(`"${promptOf(call.input)}"`));
        if (sent.reads.length <= failedReadings) throw new Error("Spark is down");
        const answered = sent.reads.length - failedReadings;
        return result(readings[Math.min(answered, readings.length) - 1]);
      }
      const marked = JSON.stringify(call.input).match(/data:image\/webp;base64,([^"]+)/)?.[1];
      const sample = marked ? (Buffer.from(marked, "base64")[30] ?? 0) : 0;
      if (!sample && sourceFails) throw new Error("Spark is down");
      if (sample && ++transcribed <= failedSamples) throw new Error("Spark is down");
      const texts: ImageTexts = { texts: sample ? (samples[sample - 1] ?? GOOD) : sourceTexts };
      return result(texts);
    },
    async imageEdit(call: { prompt: string }) {
      sent.edits.push(call.prompt);
      if (sent.edits.length <= failedEdits) throw new Error("Muse Image is down");
      const unreadable = sent.edits.length <= failedEdits + unreadableEdits;
      const b64 = unreadable ? Buffer.from("<svg/>").toString("base64") : webp(sent.edits.length);
      return result(null, { b64, format: "webp" });
    },
  } as unknown as Provider;
  const pages: Pick<PageFetcher, "fetchView" | "fetchImage"> = {
    async fetchView<T>(url: string, view: PageView<T>) {
      if (view.name === "figures") {
        return { ok: true, final_url: url, value: (shown[url] ?? []) as T };
      }
      sent.files.push(url);
      const info = files[url];
      return info
        ? { ok: true, final_url: url, value: info as T }
        : { ok: false, url, reason: "HTTP 404" };
    },
    async fetchImage(url: string) {
      return { ok: true, final_url: url, mime: "image/png", b64: PNG };
    },
  };
  const orchestrator = createOrchestrator({ store, makeProvider: () => provider });
  const builder = createDiagramsBuilder({
    orchestrator,
    store,
    sessionId: "s1",
    pages,
    brief: (lessonId) => (lessonId === "L2" ? BRIEF : undefined),
  });
  const trace = () => store.readTrace<TraceEvent>("s1");
  return { store, builder, sent, trace };
}

describe("a lesson's diagrams", () => {
  it("looks on the pages the lesson quotes first, then its other Wikimedia pages", () => {
    expect(BRIEF.pages).toEqual([
      {
        resource_id: "r_en",
        url: EN_PAGE,
        sections: [
          { index: 0, heading: "Mechanics" },
          { index: 1, heading: "Implementation [ edit ]" },
        ],
      },
      { resource_id: "r_ru", url: RU_PAGE, sections: [] },
    ]);
    expect(BRIEF.glossary).toEqual([{ term: "sum", ar: "مجموع" }]);
  });

  it("relabels a public-domain diagram once the code check passes, and serves its images", async () => {
    const { store, builder, sent, trace } = setup({
      files: { [EXAMPLE]: file(["MPL 2", "LGPL"]), [PIVOTED]: file(["Public domain"]) },
    });

    const [diagram, ...more] = await builder.build("L2");

    expect(more).toEqual([]);
    expect(sent.files).toEqual([EXAMPLE, PIVOTED]);
    expect(diagram).toMatchObject({
      caption_ar: LABELS.caption_ar,
      resource_id: "r_ru",
      section: 0,
      file: { title: "Pivottable-Pivoted.PNG", page_url: PIVOTED },
      author: "Wikidan829 at English Wikipedia",
      licence: { spdx: "LicenseRef-PublicDomain", name: "Public domain", adapt: true },
      labels: [
        { src: "Sum of Units", ar: "مجموع الوحدات", bbox: [56, 27, 111, 28] },
        { src: "Region", ar: "المنطقة", bbox: [0, 69, 56, 13] },
      ],
      method: "muse_image",
      source: { mime: "image/png", width: 558, height: 137 },
      output: { mime: "image/webp", width: 2928, height: 720 },
      check: { attempts: 1, problems: [] },
    });
    expect(sent.edits).toHaveLength(1);
    expect(sent.edits[0]).toContain('"Sum of Units" -> "مجموع الوحدات"');
    expect(sent.reads[0]).toContain("sum = مجموع");

    const served = diagramImageResponse(store, "s1", "L2", diagram?.output?.ref ?? "");
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await served.arrayBuffer()).toString("base64")).toBe(webp(1));
    const profile = store.writeBlob("s1", { mime: "text/plain", b64: "the learner's profile" });
    expect(diagramImageResponse(store, "s1", "L2", profile).status).toBe(404);
    expect(diagramImageResponse(store, "s1", "L1", diagram?.output?.ref ?? "").status).toBe(404);

    const said = trace().filter((e) => e.agent === "diagrams" && e.kind === "decision");
    expect(said.map((e) => e.summary_en)).toEqual([
      expect.stringMatching(/^Starting step diagrams:L2:/),
      "Skipping Pivot table example.svg: its file page states MPL 2, which is not on the allowlist",
      "Pivottable-Pivoted.PNG relabelled: sample 1 passes the code check",
      "Lesson L2 gets Pivottable-Pivoted.PNG (muse_image, Public domain)",
    ]);
    for (const e of said) expect(e.summary_ar).toMatch(/[؀-ۿ]/);
  });

  it("makes them once for a lesson", async () => {
    const { builder, sent } = setup();

    const first = await builder.build("L2");
    const again = await builder.build("L2");

    expect(again).toEqual(first);
    expect(sent.reads).toHaveLength(1);
    expect(sent.edits).toHaveLength(1);
  });

  it.each([["CC BY-ND 4.0"], ["CC BY-NC-SA 3.0"]])(
    "never edits an image under %s, and shows it with an Arabic legend",
    async (licence) => {
      const { builder, sent } = setup({ files: { [PIVOTED]: file([licence]) } });

      const [diagram] = await builder.build("L2");

      expect(sent.edits).toEqual([]);
      expect(diagram).toMatchObject({
        licence: { name: licence, adapt: false },
        method: "legend",
        output: null,
        labels: [{ ar: "مجموع الوحدات" }, { ar: "المنطقة" }],
        check: { attempts: 0, problems: [] },
      });
    },
  );

  it("redraws once, told what the check found, then falls back to the legend", async () => {
    const { builder, sent, trace } = setup({ samples: [LEFT_OVER, LEFT_OVER] });

    const [diagram] = await builder.build("L2");

    expect(sent.edits).toHaveLength(2);
    expect(sent.edits[0]).not.toContain("checked and failed");
    expect(sent.edits[1]).toContain(
      'A first edit was checked and failed: the Arabic label "المنطقة" appears 0 of 1 times; the source text "Region" is still there.',
    );
    expect(diagram).toMatchObject({
      method: "legend",
      output: null,
      check: {
        attempts: 2,
        problems: expect.arrayContaining(['the source text "Region" is still there']),
      },
    });
    const failed = trace().filter((e) => /fails the code check/.test(e.summary_en));
    expect(failed).toHaveLength(2);
    expect(failed.every((e) => e.payload_ref?.startsWith("blob_"))).toBe(true);
  });

  it("keeps the second sample when it passes", async () => {
    const { builder, sent } = setup({ samples: [LEFT_OVER, GOOD] });

    const [diagram] = await builder.build("L2");

    expect(sent.edits).toHaveLength(2);
    expect(diagram).toMatchObject({ method: "muse_image", check: { attempts: 2, problems: [] } });
  });

  it("reads the labels once more when they drop a glossary term", async () => {
    const off = {
      ...LABELS,
      labels: [{ ...LABELS.labels[0], ar: "إجمالي الوحدات" }],
    } as DiagramLabels;
    const { builder, sent } = setup({ readings: [off, LABELS] });

    const [diagram] = await builder.build("L2");

    expect(sent.reads).toHaveLength(2);
    expect(sent.reads[1]).toContain(
      'A first reading broke the glossary: "Sum of Units" holds the glossary term "sum": write it «مجموع».',
    );
    expect(diagram?.labels[0]?.ar).toBe("مجموع الوحدات");
  });

  it("shows the legend after one sample when the source cannot be transcribed to check it", async () => {
    const { builder, sent } = setup({ sourceFails: true });

    const [diagram] = await builder.build("L2");

    expect(sent.edits).toHaveLength(1);
    expect(diagram).toMatchObject({
      method: "legend",
      output: null,
      check: { attempts: 1, problems: ["the source could not be transcribed: Spark is down"] },
    });
  });

  it("shows the override table's Arabic for a term it names, traces it, and sends the edit the reading's", async () => {
    const { builder, sent, trace } = setup({
      readings: [HAIRCUT],
      sourceTexts: HAIRCUT_SOURCE,
      samples: [HAIRCUT_LEFT_OVER, HAIRCUT_LEFT_OVER],
    });

    const [diagram] = await builder.build("L2");

    expect(sent.edits).toHaveLength(2);
    for (const edit of sent.edits) expect(edit).toContain('"BUZZ CUT" -> "قصة قصيرة"');
    expect(diagram).toMatchObject({
      method: "legend",
      labels: [
        { src: "Sum of Units", ar: "مجموع الوحدات" },
        { src: "Region", ar: "المنطقة" },
        { src: "BUZZ CUT", ar: "قَصّة شعر قصيرة" },
      ],
      check: { attempts: 2 },
    });
    const said = trace().filter((e) => /override/.test(e.summary_en));
    expect(said).toEqual([
      expect.objectContaining({
        kind: "decision",
        summary_en:
          'Pivottable-Pivoted.PNG: the override table corrects "BUZZ CUT" from «قصة قصيرة» to the approved «قَصّة شعر قصيرة»',
      }),
    ]);
    expect(said[0]?.summary_ar).toMatch(/BUZZ CUT.*قَصّة شعر قصيرة/);
  });

  it("falls back to the legend, with no second sample, when a sample passes drawn with the reading's Arabic for an overridden term", async () => {
    const { builder, sent, trace } = setup({
      readings: [HAIRCUT],
      sourceTexts: HAIRCUT_SOURCE,
      samples: [HAIRCUT_GOOD],
    });

    const [diagram] = await builder.build("L2");

    expect(sent.edits).toHaveLength(1);
    expect(diagram).toMatchObject({
      method: "legend",
      output: null,
      labels: [
        { ar: "مجموع الوحدات" },
        { ar: "المنطقة" },
        { src: "BUZZ CUT", ar: "قَصّة شعر قصيرة" },
      ],
      check: {
        attempts: 1,
        problems: [
          'sample 1 passes the code check but is drawn with the reading\'s Arabic for an overridden term: "BUZZ CUT" from «قصة قصيرة» to the approved «قَصّة شعر قصيرة»',
        ],
      },
    });
    const fell = trace().filter((e) => /showing the legend/.test(e.summary_en));
    expect(fell).toHaveLength(1);
    expect(fell[0]?.payload_ref).toMatch(/^blob_/);
    expect(fell[0]?.summary_ar).toMatch(/\p{Script=Arabic}/u);
  });

  it("tries the next image when one fails, and fails the step only when every image fails", async () => {
    const open = { [EXAMPLE]: file(["Public domain"]), [PIVOTED]: file(["Public domain"]) };
    const once = setup({ files: open, failedReadings: 1 });

    const [diagram] = await once.builder.build("L2");

    expect(diagram?.file.page_url).toBe(PIVOTED);
    expect(once.trace().map((e) => e.summary_en)).toContain(
      "Pivot table example.svg failed (Spark is down); trying the next image",
    );

    const always = setup({ files: open, failedReadings: Number.POSITIVE_INFINITY });
    await expect(always.builder.build("L2")).rejects.toThrow(StepFailed);
  });

  it("counts an edit that answers no readable image as a failed sample", async () => {
    const { builder, sent, trace } = setup({ unreadableEdits: 1 });

    const [diagram] = await builder.build("L2");

    expect(sent.edits).toHaveLength(2);
    expect(diagram).toMatchObject({ method: "muse_image", check: { attempts: 2, problems: [] } });
    expect(trace().map((e) => e.summary_en)).toContain(
      "Pivottable-Pivoted.PNG sample 1 fails the code check: Muse Image returned no image code can read",
    );
  });

  it.each([
    ["edit", (failedEdits: number) => ({ failedEdits }), "Muse Image is down"],
    ["sample's transcription", (failedSamples: number) => ({ failedSamples }), "Spark is down"],
  ])(
    "tries the next image when the %s throws, and fails the step, saving nothing, when every image's does",
    async (_, failing, error) => {
      const open = { [EXAMPLE]: file(["Public domain"]), [PIVOTED]: file(["Public domain"]) };
      const once = setup({ files: open, ...failing(1) });

      const [diagram] = await once.builder.build("L2");

      expect(diagram).toMatchObject({ file: { page_url: PIVOTED }, method: "muse_image" });
      expect(once.trace().map((e) => e.summary_en)).toContain(
        `Pivot table example.svg failed (${error}); trying the next image`,
      );

      const always = setup({ files: open, ...failing(Number.POSITIVE_INFINITY) });
      await expect(always.builder.build("L2")).rejects.toThrow(StepFailed);
      expect(always.store.readDoc("s1", "diagrams")).toBeUndefined();
    },
  );

  it("tries a file that two of the lesson's pages show once", async () => {
    const pivoted = { file_page: PIVOTED, heading: "Example", width: 558, height: 137 };
    const acronyms = { ...LABELS, labels: [{ src: "ETL", ar: "ETL", box: [0, 0, 100, 100] }] };
    const { builder, sent } = setup({
      shown: { [EN_PAGE]: [pivoted], [RU_PAGE]: [pivoted] },
      readings: [acronyms],
    });

    expect(await builder.build("L2")).toEqual([]);
    expect(sent.files).toEqual([PIVOTED]);
    expect(sent.reads).toHaveLength(1);
  });

  it("skips an image whose file page cannot be read, or whose text stays untranslated", async () => {
    const acronyms = { ...LABELS, labels: [{ src: "ETL", ar: "ETL", box: [0, 0, 100, 100] }] };
    const { builder, sent, trace } = setup({ readings: [acronyms] });

    expect(await builder.build("L2")).toEqual([]);
    expect(sent.edits).toEqual([]);
    expect(trace().map((e) => e.summary_en)).toEqual(
      expect.arrayContaining([
        "Skipping Pivot table example.svg: its file page could not be read (HTTP 404)",
        "Skipping Pivottable-Pivoted.PNG: no text in it was translated into Arabic",
      ]),
    );
  });

  it("gives a lesson no diagram when no image passes, and says why", async () => {
    const { builder, sent, trace } = setup({
      files: { [PIVOTED]: file(["CC BY-SA 4.0", "GFDL"]) },
    });

    expect(await builder.build("L2")).toEqual([]);
    expect(sent.reads).toEqual([]);
    expect(trace().map((e) => e.summary_en)).toContain(
      "Lesson L2 gets no diagram: none of its pages' images passed",
    );
  });

  it("waits for the lesson to be written", async () => {
    const { builder } = setup();

    await expect(builder.build("L3")).rejects.toThrow(LessonNotWritten);
  });
});
