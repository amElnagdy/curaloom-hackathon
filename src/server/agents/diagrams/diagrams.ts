// The diagrams agent (#28) gives a written lesson one diagram from the pages it quotes, its labels in
// Arabic. Code finds the images a quoted Wikimedia page shows and reads each image's licence and
// author from its own file page. Spark 1.3 reads the labels and translates them with the course
// glossary. Under CC0, public domain, CC BY or CC BY-SA, Muse Image 1.0 redraws the diagram with the
// Arabic labels, and code checks Spark's transcripts of both images, text block by text block,
// retrying once. An image whose licence forbids changes, or whose check fails twice, is shown as it
// is beside a legend of its labels in Arabic.

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
import { savedLessons } from "../lesson/lesson.ts";
import {
  type GlossaryTerm,
  glossaryProblems,
  imageSize,
  rankFigures,
  relabelProblems,
} from "./rules.ts";
import {
  FIGURES,
  FILE_PAGE,
  type Figure,
  fileTitle,
  imageLicence,
  isWikimediaPage,
} from "./wiki.ts";

// One diagram a lesson, from the first of its pages' images that passes, and at most this many file
// pages read to find it.
const MAX_DIAGRAMS = 1;
const MAX_FIGURES = 4;
// Muse Image samples per diagram: the first, and one retry told what the check found.
const MAX_SAMPLES = 2;

// All the diagrams agent knows: the lesson, its Wikimedia pages with the headings each section
// quotes under (the pages it quotes first, then the rest of its resources), and its glossary terms.
export type DiagramsBrief = {
  lesson_id: string;
  title_ar: string;
  pages: { resource_id: string; url: string; sections: { index: number; heading: string }[] }[];
  glossary: GlossaryTerm[];
};

// `resources` are the lesson's resources in the plan.
export function diagramsBrief(
  lesson: Lesson,
  resources: Pick<Resource, "id" | "url">[],
  glossary: GlossaryEntry[],
): DiagramsBrief {
  const quoted = lesson.sections.map((s) => s.source_excerpt.resource_id);
  const ids = [...new Set([...quoted, ...resources.map((r) => r.id)])];
  return {
    lesson_id: lesson.id,
    title_ar: lesson.title_ar,
    pages: ids.flatMap((id) => {
      const url = resources.find((r) => r.id === id)?.url;
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
- box: [x_min, y_min, x_max, y_max] tight around the text only, on a normalized 0-1000 grid with (0,0) at the top-left.
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
type Image = ImageInput & { width: number; height: number };

const dataUrl = (image: ImageInput) => `data:${image.mime};base64,${image.b64}`;

// Spark's box, [x_min, y_min, x_max, y_max] on a 0-1000 grid, as [x, y, width, height] in pixels.
function bboxOf(box: number[], { width, height }: Image): number[] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = box.map((v) => Math.min(1000, Math.max(0, v)));
  const x = Math.round((Math.min(x1, x2) * width) / 1000);
  const y = Math.round((Math.min(y1, y2) * height) / 1000);
  return [
    x,
    y,
    Math.round((Math.max(x1, x2) * width) / 1000) - x,
    Math.round((Math.max(y1, y2) * height) / 1000) - y,
  ];
}

// Spark reads and translates the labels. A label that drops a glossary term gets one more reading
// told which; what is still off then is traced, and the labels are used.
async function readLabels(
  ctx: AgentContext,
  brief: DiagramsBrief,
  title: string,
  image: Image,
): Promise<DiagramLabels> {
  let misses: string[] = [];
  for (let reading = 1; ; reading++) {
    const { json } = await ctx.provider.structured({
      role: "diagram_labels",
      trace: {
        agent: "diagrams",
        summary_ar: `يقرأ نصوص الرسم ${title} ويترجمها بمصطلحات المسرد`,
        summary_en: `Reading and translating the labels of ${title}${reading > 1 ? " again, told the glossary misses" : ""}`,
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
    const labels = read.labels.filter((l) => l.src.trim() && l.ar.trim());
    misses = glossaryProblems(labels, brief.glossary);
    if (!misses.length || reading === 2) {
      if (misses.length) {
        ctx.trace({
          kind: "decision",
          summary_ar: `بقيت في ترجمة نصوص الرسم ${title} مصطلحات لا تطابق المسرد: ${misses.length}`,
          summary_en: `${title}: labels still off the glossary after two readings: ${misses.join("; ")}`,
        });
      }
      return { caption_ar: read.caption_ar.trim(), labels };
    }
    ctx.trace({
      kind: "decision",
      summary_ar: `ترجمة نصوص الرسم ${title} خالفت المسرد؛ يعيد القراءة مرة واحدة`,
      summary_en: `${title}: labels off the glossary, reading once more: ${misses.join("; ")}`,
    });
  }
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

// Muse Image redraws the diagram with the Arabic labels; code compares Spark's transcripts of the
// source and of each sample. A failed sample is kept in a blob the trace names.
async function relabel(
  ctx: AgentContext,
  title: string,
  image: Image,
  labels: Label[],
): Promise<Relabelled> {
  const source = transcribe(ctx, image, { ar: "الرسم الأصلي", en: `the source of ${title}` });
  source.catch(() => {});
  let problems: string[] = [];
  for (let sample = 1; sample <= MAX_SAMPLES; sample++) {
    let output: Image | null = null;
    try {
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
      const size = imageSize(Buffer.from(b64, "base64"));
      if (!size) throw new Error("Muse Image returned no image code can read");
      output = { b64, mime: `image/${edit.image?.format ?? "webp"}`, ...size };
      const texts = await transcribe(ctx, output, {
        ar: "الرسم المعرَّب",
        en: `${title} relabelled (sample ${sample})`,
      });
      problems = relabelProblems(labels, await source, texts);
    } catch (e) {
      problems = [`the sample could not be made or read: ${e instanceof Error ? e.message : e}`];
    }
    if (!problems.length && output) {
      ctx.trace({
        kind: "decision",
        summary_ar: `اجتاز الرسم المعرَّب ${title} فحص الكود: كل نص عربي في مكانه ولا نص من الأصل باقٍ`,
        summary_en: `${title} relabelled: sample ${sample} passes the code check`,
      });
      return {
        method: "muse_image",
        output: saveImage(ctx, output),
        check: { attempts: sample, problems },
      };
    }
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

// The diagram an image makes, or null when it makes none: its file page states no licence code
// accepts, or it cannot be fetched or read, or it has no text to translate.
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
  if (!file.ok) return null;
  const licence = imageLicence(file.value, figure.file_page);
  if (!licence.ok) return skip(licence.reason_ar, licence.reason);
  if (!file.value.image_url)
    return skip("لا تذكر صفحة ملفه رابط الصورة", "its file page names no image");
  const fetched = await pages.fetchImage(file.value.image_url, ctx.trace);
  if (!fetched.ok) return null;
  const size = imageSize(Buffer.from(fetched.b64, "base64"));
  if (!size) return skip("لم يقرأ الكود مقاسها", "code cannot read its size");
  const image: Image = { b64: fetched.b64, mime: fetched.mime, ...size };

  const { caption_ar, labels } = await readLabels(ctx, brief, title, image);
  if (!labels.length) return skip("ليس فيه نص يُترجم", "it has no text to translate");
  const { ok: _, ...cited } = licence;
  const diagram = {
    image_id: `img_${contentHash(figure.file_page)}`,
    caption_ar,
    resource_id: figure.resource_id,
    section: figure.section,
    file: { title, page_url: figure.file_page, image_url: file.value.image_url },
    author: file.value.author,
    licence: cited,
    labels: labels.map((l) => ({ src: l.src, ar: l.ar, bbox: bboxOf(l.box, image) })),
    source: saveImage(ctx, image),
  };
  if (!licence.adapt) {
    ctx.trace({
      kind: "decision",
      summary_ar: `ترخيص ${licence.name} لا يسمح بتعديل الرسم ${title}؛ يعرضه كما هو مع جدول نصوصه بالعربية`,
      summary_en: `${title} is under ${licence.name}, which allows no changes: shown as it is with an Arabic legend`,
    });
    return { ...diagram, method: "legend", output: null, check: { attempts: 0, problems: [] } };
  }
  return { ...diagram, ...(await relabel(ctx, title, image, labels)) };
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
    for (const figure of rankFigures(shown).slice(0, MAX_FIGURES)) {
      if (diagrams.length === MAX_DIAGRAMS) break;
      const diagram = await diagramOf(ctx, pages, brief, figure);
      if (diagram) diagrams.push(diagram);
    }
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

// Each lesson's diagrams and the brief (its hash) they were made for.
type SavedDiagrams = Record<string, { brief: string; diagrams: Diagram[] }>;

// The lesson's diagrams, if they were made for this brief.
export function savedDiagrams(
  store: Store,
  sessionId: string,
  brief: DiagramsBrief,
): Diagram[] | undefined {
  const saved = store.readDoc<SavedDiagrams>(sessionId, DIAGRAMS_DOC)?.[brief.lesson_id];
  return saved?.brief === contentHash(brief) ? saved.diagrams : undefined;
}

// The brief for a written lesson of the learner's plan, or undefined before it is written.
// The course a lesson's diagrams come from: the latest plan, its resources, the lessons written for
// it and their glossary.
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
  // The lesson's resources as the lesson builder had them: those its sessions name, verified.
  const sessions = course.plan.committed.sessions.filter((s) => s.lesson_id === lessonId);
  const ids = new Set(sessions.flatMap((s) => s.resource_ids));
  const resources = course.resources.filter((r) => ids.has(r.id) && r.licence.verified);
  return diagramsBrief(lesson, resources, course.glossary);
}

// The learner's written course, or undefined before his plan.
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

// An image a lesson's diagram shows, by its blob ref; undefined for any other ref.
export function diagramImage(
  store: Store,
  sessionId: string,
  lessonId: string,
  ref: string,
): { mime: string; bytes: Buffer } | undefined {
  const diagrams = store.readDoc<SavedDiagrams>(sessionId, DIAGRAMS_DOC)?.[lessonId]?.diagrams;
  const shown = diagrams?.some((d) => d.source.ref === ref || d.output?.ref === ref);
  if (!shown) return undefined;
  const { mime, b64 } = store.readBlob<ImageInput>(sessionId, ref);
  return { mime, bytes: Buffer.from(b64, "base64") };
}

// Diagrams asked for before their lesson is written.
export class DiagramsConflict extends Error {}

export type DiagramsBuilderDeps = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  store: Store;
  sessionId: string;
  pages: Pick<PageFetcher, "fetchView" | "fetchImage">;
  // The brief for a written lesson: the route passes lessonDiagramsBrief on the learner's plan.
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
    // The lesson's diagrams, made on the first call for this brief.
    async build(lessonId: string): Promise<Diagram[]> {
      const brief = briefFor(lessonId);
      if (!brief) throw new DiagramsConflict(`Lesson ${lessonId} is not written yet`);
      const saved = savedDiagrams(store, sessionId, brief);
      if (saved) return saved;
      const hash = contentHash(brief);
      const { diagrams } = await orchestrator.runStep(sessionId, diagramsAgent(pages), brief, {
        key: `diagrams:${lessonId}:${hash}`,
      });
      const doc = store.readDoc<SavedDiagrams>(sessionId, DIAGRAMS_DOC) ?? {};
      store.writeDoc(sessionId, DIAGRAMS_DOC, { ...doc, [lessonId]: { brief: hash, diagrams } });
      return diagrams;
    },
  };
}

export type DiagramsBuilder = ReturnType<typeof createDiagramsBuilder>;
