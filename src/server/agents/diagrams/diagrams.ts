import {
  type CoursePlan,
  type Diagram,
  DiagramLabels,
  type GlossaryEntry,
  ImageTexts,
  type LearnerProfile,
  type Lesson,
  LessonDiagrams,
  type Resource,
  validate,
} from "../../../../contracts/index.ts";
import type { Agent, AgentContext, createOrchestrator } from "../../orchestrator/orchestrator.ts";
import type { ImageInput } from "../../providers/provider.ts";
import { contentHash, type Store } from "../../store/store.ts";
import type { PageFetcher } from "../../tools/fetch-page.ts";
import { planFor } from "../architect/architect.ts";
import { lessonResources, savedLessons } from "../lesson/lesson.ts";
import { type Overridden, overrideLabels, overridesNote } from "./glossary-overrides.ts";
import {
  type GlossaryTerm,
  glossaryProblems,
  type ImageHeader,
  imageHeader,
  rankFigures,
  relabelProblems,
} from "./rules.ts";
import {
  FIGURES,
  FILE_PAGE,
  type Figure,
  fileTitle,
  forbidsChanges,
  imageLicence,
  isWikimediaPage,
} from "./wiki.ts";

const MAX_DIAGRAMS = 1;
const MAX_FIGURES = 4;
const MAX_SAMPLES = 2;
// Spark gives each box on a square grid of this many steps, whatever the image's size.
const GRID = 1000;

export type DiagramsBrief = {
  lesson_id: string;
  title_ar: string;
  pages: { resource_id: string; url: string; sections: { index: number; heading: string }[] }[];
  glossary: GlossaryTerm[];
};

export function diagramsBrief(
  lesson: Lesson,
  quotable: Pick<Resource, "id" | "url">[],
  glossary: GlossaryEntry[],
): DiagramsBrief {
  const quoted = lesson.sections.map((s) => s.source_excerpt.resource_id);
  const ids = [...new Set([...quoted, ...quotable.map((r) => r.id)])];
  return {
    lesson_id: lesson.id,
    title_ar: lesson.title_ar,
    pages: ids.flatMap((id) => {
      const url = quotable.find((r) => r.id === id)?.url;
      if (!url || !isWikimediaPage(url)) return [];
      const sections = lesson.sections.flatMap((s, index) =>
        s.source_excerpt.resource_id === id ? [{ index, heading: s.source_excerpt.locator }] : [],
      );
      return [{ resource_id: id, url, sections }];
    }),
    glossary: glossary
      .filter((g) => lesson.glossary_ids.includes(g.id))
      .map((g) => ({ term: g.src.term, ar: g.ar })),
  };
}

const READ_PROMPT = `You are an object grounding expert and a technical translator for Arabic-speaking learners.
The image is a diagram. List every piece of text in it that a learner needs in Arabic: words and phrases in any language.
Skip text that stays as written: numbers, dates, single column letters, row numbers, and acronyms such as ETL, ERP, ODS, SCM or GDP.
Give one entry per separate text block (one table cell, one shape caption, one title line), in reading order. Include repeats: a word that appears in five cells gets five entries.
For each entry:
- src: the text exactly as written.
- ar: a short Modern Standard Arabic translation that fits the same space. Keep any acronym inside the text in Latin letters.
- box: [x_min, y_min, x_max, y_max] tight around the text only, on a normalized 0-${GRID} grid with (0,0) at the top-left.
Do not miss any text. Then give caption_ar: one short Arabic line that says what the diagram shows.`;

const TRANSCRIBE_PROMPT = `List every piece of text in this image exactly as written, in any language or script, including numbers and dates.
Give one entry per separate text block (one table cell, one shape caption, one title line), in reading order.
Do not translate, correct or complete anything.`;

const EDIT_PROMPT = `Edit this diagram: replace each text below with its Arabic translation, everywhere it appears.
Each line gives a whole text block as written, then the Arabic that takes its place: erase the whole source text, numbers and symbols inside it included, and write only the Arabic there, so no source word is left and no number appears twice.
Change nothing else. Keep the layout, shapes, colours, lines, numbers, dates and acronyms exactly as they are.
Write the Arabic right to left, with correctly joined letters, in a plain sans-serif font sized to fit the space of the text it replaces.`;

const readPrompt = (glossary: GlossaryTerm[], misses: string[]) =>
  [
    READ_PROMPT,
    glossary.length &&
      `Use these glossary terms where they apply: ${glossary.map((g) => `${g.term} = ${g.ar}`).join("; ")}.`,
    misses.length && `A first reading broke the glossary: ${misses.join("; ")}.`,
  ]
    .filter(Boolean)
    .join("\n");

const editPrompt = (labels: Label[], problems: string[]) =>
  [
    EDIT_PROMPT,
    ...new Set(labels.map((l) => `"${l.src}" -> "${l.ar}"`)),
    problems.length &&
      `A first edit was checked and failed: ${problems.join("; ")}. Fix exactly these.`,
  ]
    .filter(Boolean)
    .join("\n");

type Label = DiagramLabels["labels"][number];
type Image = { b64: string } & ImageHeader;

const dataUrl = (image: ImageInput) => `data:${image.mime};base64,${image.b64}`;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ARABIC = /\p{Script=Arabic}/u;

function bboxOf(box: number[], { width, height }: Image): number[] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = box.map((v) => Math.min(GRID, Math.max(0, v)));
  const x = Math.round((Math.min(x1, x2) * width) / GRID);
  const y = Math.round((Math.min(y1, y2) * height) / GRID);
  return [
    x,
    y,
    Math.round((Math.max(x1, x2) * width) / GRID) - x,
    Math.round((Math.max(y1, y2) * height) / GRID) - y,
  ];
}

async function readOnce(
  ctx: AgentContext,
  brief: DiagramsBrief,
  title: string,
  image: Image,
  misses: string[],
): Promise<DiagramLabels> {
  const { json } = await ctx.provider.structured({
    role: "diagram_labels",
    trace: {
      agent: "diagrams",
      summary_ar: `يقرأ نصوص الرسم ${title} ويترجمها بمصطلحات المسرد`,
      summary_en: `Reading and translating the labels of ${title}${misses.length ? " again, told the glossary misses" : ""}`,
    },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: readPrompt(brief.glossary, misses) },
          { type: "input_image", image_url: dataUrl(image) },
        ],
      },
    ],
    schema: { name: "DiagramLabels", schema: DiagramLabels },
  });
  const read = validate(DiagramLabels, json);
  return {
    caption_ar: read.caption_ar.trim(),
    labels: read.labels.filter((l) => l.src.trim() && l.ar.trim()),
  };
}

// One reading, and a second told what broke the glossary if the first did.
async function readLabels(
  ctx: AgentContext,
  brief: DiagramsBrief,
  title: string,
  image: Image,
): Promise<DiagramLabels> {
  const first = await readOnce(ctx, brief, title, image, []);
  const misses = glossaryProblems(first.labels, brief.glossary);
  if (!misses.length) return first;
  ctx.trace({
    kind: "decision",
    summary_ar: `ترجمة نصوص الرسم ${title} خالفت المسرد؛ يعيد القراءة مرة واحدة`,
    summary_en: `${title}: labels off the glossary, reading once more: ${misses.join("; ")}`,
  });
  const second = await readOnce(ctx, brief, title, image, misses);
  const still = glossaryProblems(second.labels, brief.glossary);
  if (still.length) {
    ctx.trace({
      kind: "decision",
      summary_ar: `بقيت في ترجمة نصوص الرسم ${title} مصطلحات لا تطابق المسرد: ${still.length}`,
      summary_en: `${title}: labels still off the glossary after two readings: ${still.join("; ")}`,
    });
  }
  return second;
}

async function transcribe(ctx: AgentContext, image: ImageInput, what: { ar: string; en: string }) {
  const { json } = await ctx.provider.structured({
    role: "image_text",
    trace: {
      agent: "diagrams",
      summary_ar: `ينسخ نصوص ${what.ar} ليقارنها الكود`,
      summary_en: `Transcribing ${what.en} for the code check`,
    },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: TRANSCRIBE_PROMPT },
          { type: "input_image", image_url: dataUrl(image) },
        ],
      },
    ],
    schema: { name: "ImageTexts", schema: ImageTexts },
  });
  return validate(ImageTexts, json).texts;
}

const saveImage = (ctx: AgentContext, image: Image) => ({
  ref: ctx.store.writeBlob(ctx.sessionId, { mime: image.mime, b64: image.b64 }),
  mime: image.mime,
  width: image.width,
  height: image.height,
});

type Relabelled = Pick<Diagram, "method" | "output" | "check">;

async function relabel(
  ctx: AgentContext,
  title: string,
  image: Image,
  labels: Label[],
  overridden: Overridden[],
): Promise<Relabelled> {
  const source = transcribe(ctx, image, { ar: "الرسم الأصلي", en: `the source of ${title}` }).then(
    (texts) => ({ texts }),
    (e: unknown) => ({ error: messageOf(e) }),
  );
  // A throw from the edit or the sample's transcription goes up to the agent, which tries the next
  // image. Caught here, it would save a legend that outlives the outage.
  let problems: string[] = [];
  for (let sample = 1; sample <= MAX_SAMPLES; sample++) {
    const edit = await ctx.provider.imageEdit({
      role: "image_edit",
      trace: {
        agent: "diagrams",
        summary_ar: `يعيد رسم ${title} بالنصوص العربية`,
        summary_en: `Redrawing ${title} with the Arabic labels (sample ${sample})`,
      },
      prompt: editPrompt(labels, problems),
      images: [image],
      size: { width: image.width, height: image.height },
      format: "webp",
    });
    const b64 = edit.image?.b64 ?? "";
    const header = imageHeader(Buffer.from(b64, "base64"));
    const output: Image | null = header ? { b64, ...header } : null;
    if (output) {
      const read = await source;
      if ("error" in read) {
        ctx.trace({
          kind: "decision",
          summary_ar: `تعذّر نسخ نصوص الرسم الأصلي ${title}، فلا يُفحص الرسم المعرَّب؛ يعرض الأصل مع جدول نصوصه بالعربية`,
          summary_en: `${title}: the source could not be transcribed, so no sample can be checked: ${read.error}`,
        });
        return {
          method: "legend",
          output: null,
          check: {
            attempts: sample,
            problems: [`the source could not be transcribed: ${read.error}`],
          },
        };
      }
      const texts = await transcribe(ctx, output, {
        ar: "الرسم المعرَّب",
        en: `${title} relabelled (sample ${sample})`,
      });
      problems = relabelProblems(labels, read.texts, texts);
      if (!problems.length && overridden.length) {
        // The edit wrote the reading's Arabic, which the override table rejects, and another edit
        // from the same labels would write it again.
        const note = overridesNote(overridden);
        problems = [
          `sample ${sample} passes the code check but is drawn with the reading's Arabic for an overridden term: ${note.en}`,
        ];
        ctx.trace({
          kind: "decision",
          summary_ar: `اجتاز الرسم المعرَّب ${title} فحص الكود لكنه كُتب بترجمة النموذج لمصطلح صحّحه جدول المصطلحات المعتمدة (${note.ar})؛ يعرض الأصل مع جدول نصوصه بالعربية`,
          summary_en: `${title} sample ${sample} passes the code check but carries the reading's Arabic for an overridden term (${note.en}); showing the legend`,
          payload_ref: saveImage(ctx, output).ref,
        });
        return { method: "legend", output: null, check: { attempts: sample, problems } };
      }
      if (!problems.length) {
        ctx.trace({
          kind: "decision",
          summary_ar: `اجتاز الرسم المعرَّب ${title} فحص الكود: كل تسمية عربية بعددها وترتيبها، ولا نص من الأصل باقٍ، والأرقام كما هي`,
          summary_en: `${title} relabelled: sample ${sample} passes the code check`,
        });
        return {
          method: "muse_image",
          output: saveImage(ctx, output),
          check: { attempts: sample, problems },
        };
      }
    } else problems = ["Muse Image returned no image code can read"];
    ctx.trace({
      kind: "decision",
      summary_ar:
        sample < MAX_SAMPLES
          ? `لم يجتز الرسم المعرَّب ${title} فحص الكود؛ يعيد رسمه مرة واحدة`
          : `لم يجتز الرسم المعرَّب ${title} فحص الكود مرتين؛ يعرض الأصل مع جدول نصوصه بالعربية`,
      summary_en: `${title} sample ${sample} fails the code check: ${problems.join("; ")}`,
      ...(output && { payload_ref: saveImage(ctx, output).ref }),
    });
  }
  return { method: "legend", output: null, check: { attempts: MAX_SAMPLES, problems } };
}

async function diagramOf(
  ctx: AgentContext,
  pages: Pick<PageFetcher, "fetchView" | "fetchImage">,
  brief: DiagramsBrief,
  figure: Figure & { resource_id: string; section: number },
): Promise<Diagram | null> {
  const title = fileTitle(figure.file_page);
  const skip = (ar: string, en: string) => {
    ctx.trace({
      kind: "decision",
      summary_ar: `ترك الرسم ${title}: ${ar}`,
      summary_en: `Skipping ${title}: ${en}`,
    });
    return null;
  };
  const file = await pages.fetchView(figure.file_page, FILE_PAGE, ctx.trace);
  if (!file.ok) {
    return skip("تعذّرت قراءة صفحة ملفه", `its file page could not be read (${file.reason})`);
  }
  const licence = imageLicence(file.value, figure.file_page);
  if (!licence.ok) return skip(licence.reason_ar, licence.reason);
  if (!file.value.image_url)
    return skip("لا تذكر صفحة ملفه رابط الصورة", "its file page names no image");
  const fetched = await pages.fetchImage(file.value.image_url, ctx.trace);
  if (!fetched.ok)
    return skip("تعذّر تنزيل صورته", `its image could not be fetched (${fetched.reason})`);
  const header = imageHeader(Buffer.from(fetched.b64, "base64"));
  if (!header) return skip("لم يقرأ الكود نوعها ومقاسها", "code cannot read its type and size");
  const image: Image = { b64: fetched.b64, ...header };

  const { caption_ar, labels } = await readLabels(ctx, brief, title, image);
  if (!labels.some((l) => ARABIC.test(l.ar))) {
    return skip("ليس فيه نص تُرجم إلى العربية", "no text in it was translated into Arabic");
  }
  // The diagram shows the override table's Arabic; the edit and the check keep the reading's, so a
  // recorded request keeps its hash.
  const { labels: shown, overridden } = overrideLabels(labels);
  if (overridden.length) {
    const note = overridesNote(overridden);
    ctx.trace({
      kind: "decision",
      summary_ar: `صحّح جدول المصطلحات المعتمدة ترجمة نصوص الرسم ${title}: ${note.ar}`,
      summary_en: `${title}: the override table corrects ${note.en}`,
    });
  }
  const { ok: _, ...cited } = licence;
  const diagram = {
    image_id: `img_${contentHash(figure.file_page)}`,
    caption_ar,
    resource_id: figure.resource_id,
    section: figure.section,
    file: { title, page_url: figure.file_page, image_url: file.value.image_url },
    author: file.value.author,
    licence: cited,
    labels: shown.map((l) => ({ src: l.src, ar: l.ar, bbox: bboxOf(l.box, image) })),
    source: saveImage(ctx, image),
  };
  if (!licence.adapt) {
    const why = forbidsChanges(licence.spdx)
      ? { ar: "لا يسمح بتعديله", en: "which allows no changes" }
      : { ar: "ليس من التراخيص التي يعدّل الكود رسومها", en: "which code does not adapt" };
    ctx.trace({
      kind: "decision",
      summary_ar: `ترخيص الرسم ${title}، ${licence.name}، ${why.ar}؛ يعرضه كما هو مع جدول نصوصه بالعربية`,
      summary_en: `${title} is under ${licence.name}, ${why.en}: shown as it is with an Arabic legend`,
    });
    return { ...diagram, method: "legend", output: null, check: { attempts: 0, problems: [] } };
  }
  return { ...diagram, ...(await relabel(ctx, title, image, labels, overridden)) };
}

const diagramsAgent = (
  pages: Pick<PageFetcher, "fetchView" | "fetchImage">,
): Agent<DiagramsBrief, typeof LessonDiagrams> => ({
  name: "diagrams",
  output: LessonDiagrams,
  async run(ctx, brief) {
    const shown = await Promise.all(
      brief.pages.map(async (page) => {
        const found = await pages.fetchView(page.url, FIGURES, ctx.trace);
        const figures = found.ok ? found.value : [];
        return { ...page, figures: figures.map((f) => ({ ...f, resource_id: page.resource_id })) };
      }),
    );
    const diagrams: Diagram[] = [];
    const failures: unknown[] = [];
    for (const figure of rankFigures(shown).slice(0, MAX_FIGURES)) {
      if (diagrams.length === MAX_DIAGRAMS) break;
      try {
        const diagram = await diagramOf(ctx, pages, brief, figure);
        if (diagram) diagrams.push(diagram);
      } catch (e) {
        failures.push(e);
        ctx.trace({
          kind: "decision",
          summary_ar: `تعذّر إعداد الرسم ${fileTitle(figure.file_page)}؛ ينتقل إلى الرسم التالي`,
          summary_en: `${fileTitle(figure.file_page)} failed (${messageOf(e)}); trying the next image`,
        });
      }
    }
    // A lesson that got no diagram because every attempt failed is a failed step, so it retries.
    if (!diagrams.length && failures.length) throw failures[0];
    const [first] = diagrams;
    ctx.trace({
      kind: "decision",
      ...(first
        ? {
            summary_ar:
              first.method === "muse_image"
                ? `أضاف إلى درس «${brief.title_ar}» رسمًا بنصوص عربية`
                : `أضاف إلى درس «${brief.title_ar}» رسمًا بجدول نصوصه بالعربية`,
            summary_en: `Lesson ${brief.lesson_id} gets ${first.file.title} (${first.method}, ${first.licence.name})`,
          }
        : {
            summary_ar: `لم يجد لدرس «${brief.title_ar}» رسمًا مفتوح الترخيص فيه نص يُترجم`,
            summary_en: `Lesson ${brief.lesson_id} gets no diagram: none of its pages' images passed`,
          }),
    });
    return { diagrams };
  },
});

const DIAGRAMS_DOC = "diagrams";

type SavedDiagrams = Record<string, { brief_hash: string; diagrams: Diagram[] }>;

export function savedDiagrams(
  store: Store,
  sessionId: string,
  brief: DiagramsBrief,
): Diagram[] | undefined {
  const saved = store.readDoc<SavedDiagrams>(sessionId, DIAGRAMS_DOC)?.[brief.lesson_id];
  return saved?.brief_hash === contentHash(brief) ? saved.diagrams : undefined;
}

export type WrittenCourse = {
  plan: CoursePlan;
  resources: Resource[];
  lessons: Record<string, Lesson>;
  glossary: GlossaryEntry[];
};

export function lessonDiagramsBrief(
  course: WrittenCourse,
  lessonId: string,
): DiagramsBrief | undefined {
  const lesson = course.lessons[lessonId];
  if (!lesson) return undefined;
  const quotable = lessonResources(course.plan, course.resources, lessonId);
  return diagramsBrief(lesson, quotable, course.glossary);
}

export function writtenCourse(
  store: Store,
  sessionId: string,
  learner: LearnerProfile,
): WrittenCourse | undefined {
  const saved = planFor(store, sessionId, learner);
  const plan = saved?.versions.at(-1);
  const written = plan && savedLessons(store, sessionId, plan);
  return saved && plan && written
    ? { plan, resources: saved.resources, lessons: written.lessons, glossary: written.glossary }
    : undefined;
}

export function diagramImage(
  store: Store,
  sessionId: string,
  lessonId: string,
  ref: string,
): { mime: ImageHeader["mime"]; bytes: Buffer } | undefined {
  const diagrams = store.readDoc<SavedDiagrams>(sessionId, DIAGRAMS_DOC)?.[lessonId]?.diagrams;
  const shown = diagrams?.some((d) => d.source.ref === ref || d.output?.ref === ref);
  if (!shown) return undefined;
  const bytes = Buffer.from(store.readBlob<ImageInput>(sessionId, ref).b64, "base64");
  const header = imageHeader(bytes);
  return header ? { mime: header.mime, bytes } : undefined;
}

export class LessonNotWritten extends Error {}

export type DiagramsBuilderDeps = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  store: Store;
  sessionId: string;
  pages: Pick<PageFetcher, "fetchView" | "fetchImage">;
  brief(lessonId: string): DiagramsBrief | undefined;
};

export function createDiagramsBuilder({
  orchestrator,
  store,
  sessionId,
  pages,
  brief: briefFor,
}: DiagramsBuilderDeps) {
  return {
    async build(lessonId: string): Promise<Diagram[]> {
      const brief = briefFor(lessonId);
      if (!brief) throw new LessonNotWritten(`Lesson ${lessonId} is not written yet`);
      const saved = savedDiagrams(store, sessionId, brief);
      if (saved) return saved;
      const hash = contentHash(brief);
      const { diagrams } = await orchestrator.runStep(sessionId, diagramsAgent(pages), brief, {
        key: `diagrams:${lessonId}:${hash}`,
      });
      const doc = store.readDoc<SavedDiagrams>(sessionId, DIAGRAMS_DOC) ?? {};
      store.writeDoc(sessionId, DIAGRAMS_DOC, {
        ...doc,
        [lessonId]: { brief_hash: hash, diagrams },
      });
      return diagrams;
    },
  };
}

export type DiagramsBuilder = ReturnType<typeof createDiagramsBuilder>;
