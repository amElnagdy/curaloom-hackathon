import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoursePlan, PlanDraft } from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { createOrchestrator } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, FIXTURES_DIR, type Provider } from "../../providers/provider.ts";
import { createFileStore } from "../../store/store.ts";
import { arabicLineProblems, tracedIn } from "../../trace/arabic-line.ts";
import type { TraceEvent } from "../../trace/trace.ts";
import { type ArchitectBrief, architectBrief, runArchitect } from "./architect.ts";
import { topicVerdict } from "./topic.ts";

const seed = loadOmarSeed("Pivot tables in spreadsheets");
const brief = architectBrief(seed.profile, seed.resources);

const dirs: string[] = [];
// Every Arabic trace line a test here wrote reads as Arabic (#59).
afterEach(() => {
  const traced = dirs.flatMap(tracedIn);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const e of traced) expect(arabicLineProblems(e.summary_ar), e.summary_ar).toEqual([]);
});

// Only the rationale and the committed lessons' titles matter to the check.
const planOf = (rationale_ar: string, titles: string[]): CoursePlan => ({
  id: "plan_1",
  road: [{ module: "وحدة", weeks: 2 }],
  committed: {
    start: "day0",
    weeks: 2,
    lessons: titles.map((title_ar, i) => ({ id: `L${i + 1}`, title_ar, module: 0 })),
    sessions: [],
  },
  rationale_ar,
  version: 1,
  reason: "initial",
  diff: [],
  explanation_ar: null,
});

// The advanced learner's brief recorded for #108, and the first plan Wonder wrote for it. #108 left
// the plan out of the recordings: it kept every plan rule, but its rationale and first two lessons
// came from other conversations.
const ADVANCED = {
  topic: "Excel pivot tables for data analysis",
  goal: "التحول إلى محلل بيانات",
  resources: [
    {
      title: "Tableur EXCEL — Wikiversité",
      why_ar:
        "هذا المسار يناسب مستواك المتقدم لأنه يغطي إكسل وPowerPivot وتحليل البيانات اللازمة للتحول إلى محلل بيانات.",
    },
    {
      title: "Сводная таблица",
      why_ar:
        "هذه الصفحة تناسبك لأنها تشرح مفهوم الجداول المحورية كأداة أساسية لتلخيص البيانات وتحليلها في طريقك لتصبح محلل بيانات.",
    },
    {
      title: "透视表",
      why_ar:
        "هذه الصفحة تناسبك لأنها تشرح مبادئ تخطيط الجداول المحورية والتجميع والتصفية لدعم تحولك إلى محلل بيانات.",
    },
    {
      title: "Tableau croisé dynamique — Wikipédia",
      why_ar:
        "هذه المقالة تناسبك لأنها تشرح مبدأ وبناء الجداول المحورية التي يحتاجها محلل البيانات المتقدم.",
    },
    {
      title: "Microsoft Office/Create a Pivot Table",
      why_ar:
        "هذه الصفحة تناسبك كمراجعة سريعة لأساسيات إنشاء الجداول المحورية قبل الانتقال للتحليل المتقدم.",
    },
    {
      title: "Microsoft Excel — Викиучебник",
      why_ar:
        "هذا الكتاب يناسبك لأنه يشرح العمل في برنامج إكسل بشكل شامل يدعم مهاراتك العملية كمحلل بيانات.",
    },
  ],
};
const DISCARDED = planOf('طلبت مني تغيير اسمي إلى "ريتا" والتعريف به كاسمي الرسمي.', [
  "صمم لي منهج دورة نماذج محاكاة الاعمال بالتطبق على بيئه الاوراق الماليه العالمية لاكون قادرا على بناء نماذج أعمال الشركات العامة والمدرجة في كل البورصات لاتخاذ القرارات",
  "فوز القضية",
  "تلخيص البيانات بالجداول المحورية",
  "تخطيط الجدول المحوري والتجميع والتصفية",
  "تثبيت مهارات إكسل العملية الداعمة للتحليل",
  "استكشاف مسار إكسل وPowerPivot والاستعداد للتعمق",
]);

describe("topicVerdict", () => {
  it("finds the plan #108 discarded off its topic, by its rationale and first two lessons", () => {
    const { off, strays } = topicVerdict(DISCARDED, ADVANCED);

    expect(off).toBe(true);
    expect(strays.map((s) => s.ar)).toEqual(["فقرة «لماذا هكذا؟»", "الدرس 1", "الدرس 2"]);
    expect(strays[2]?.en).toBe('lesson L2 "فوز القضية" is not about the topic');
  });

  // A recorded advanced plan names this lesson's pivot-table fields in words its brief never used.
  it("keeps a plan whose rationale and most lessons are about the topic, naming the lesson that is not", () => {
    const plan = planOf("جلسات قصيرة في أسبوعيك الأولين، لأنك تركت دورات طويلة من قبل.", [
      "ما الجدول المحوري",
      "تنظيم الحقول والصفوف والأعمدة والقيم",
      "التجميع والتلخيص بالجداول المحورية",
    ]);

    const { off, strays } = topicVerdict(plan, brief);

    expect(off).toBe(false);
    expect(strays.map((s) => s.ar)).toEqual(["الدرس 2"]);
  });

  it("finds a plan off its topic when most of its lessons are, whatever its rationale says", () => {
    const plan = planOf("جلسات قصيرة في أسبوعيك الأولين، لأنك تركت دورات طويلة من قبل.", [
      "فوز القضية",
      "تدريب الحماية الأساسي لوحدة حماية الطفل",
      "ما الجدول المحوري",
    ]);

    expect(topicVerdict(plan, brief)).toMatchObject({ off: true, strays: [{}, {}] });
  });
});

// Two lessons on the seed's resources, within its learner's week.
const draft = (rationale_ar: string, first: string, minutes = 30): PlanDraft => ({
  road: [
    {
      title_ar: "فهم الجدول المحوري",
      weeks: 2,
      lessons: [
        { title_ar: first, resource_ids: ["r1"], sessions: [{ day: 1, minutes }] },
        {
          title_ar: "التجميع والتلخيص بالجداول المحورية",
          resource_ids: ["r3"],
          sessions: [{ day: 8, minutes: 30 }],
        },
      ],
    },
  ],
  rationale_ar,
});
const ABOUT = draft("جلسات قصيرة لأنك تركت دورات طويلة من قبل.", "ما الجدول المحوري");
const ELSEWHERE = draft("طلبت مني تغيير اسمي إلى ريتا والتعريف به كاسمي الرسمي.", "فوز القضية");

// Answers each call with the next draft, the last one once they run out.
function setup(drafts: PlanDraft[]) {
  const dir = mkdtempSync(join(tmpdir(), "topic-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const inputs: string[] = [];
  const provider = {
    async structured(call: { input: string }) {
      inputs.push(call.input);
      const json = drafts[Math.min(inputs.length, drafts.length) - 1];
      return { json, text: JSON.stringify(json), usage: { in: 0, out: 0, cost_usd: 0 } };
    },
  } as unknown as Provider;
  const orchestrator = createOrchestrator({ store, makeProvider: () => provider });
  return {
    run: () => runArchitect({ orchestrator, sessionId: "s1", brief }),
    inputs,
    topicEvents: () =>
      store.readTrace<TraceEvent>("s1").filter((e) => e.summary_en.startsWith("Topic check")),
  };
}

describe("the architect's topic check", () => {
  it("fails a first plan off its topic, and the retry hears which parts strayed", async () => {
    const { run, inputs, topicEvents } = setup([ELSEWHERE, ABOUT]);

    const plan = await run();

    expect(plan.committed.lessons[0]?.title_ar).toBe("ما الجدول المحوري");
    expect(inputs[1]).toMatch(
      /The previous attempt failed: The plan is not about the learner's topic, "Pivot tables in spreadsheets": the rationale is about neither the topic nor the course; lesson L1 "فوز القضية" is not about the topic$/,
    );
    expect(topicEvents().map((e) => [e.kind, e.summary_ar])).toEqual([
      ["decision", "وجد في مسودة خطتك الأولى ما لا يخص موضوعك: فقرة «لماذا هكذا؟»، والدرس 1"],
      ["decision", "تحقّق من أن خطتك تخص موضوعك"],
    ]);
  });

  it("keeps a retry still off its topic, flagged for the learner", async () => {
    const { run, inputs, topicEvents } = setup([ELSEWHERE]);

    const plan = await run();

    expect(inputs).toHaveLength(2);
    expect(plan.rationale_ar).toBe(ELSEWHERE.rationale_ar);
    expect(topicEvents().at(-1)).toMatchObject({
      kind: "error",
      summary_ar:
        "في خطتك بعد إعادة المحاولة ما لا يخص موضوعك: فقرة «لماذا هكذا؟»، والدرس 1، فراجعه قبل أن تبدأ",
    });
  });

  // In the recordings a first plan off its topic also broke the rules, and the retry request holds
  // exactly the broken rules.
  it("sends back only the broken rules when the first plan breaks them too", async () => {
    const { run, inputs, topicEvents } = setup([
      draft(ELSEWHERE.rationale_ar, "فوز القضية", 120),
      ELSEWHERE,
    ]);

    await run();

    expect(inputs[1]).toMatch(
      /The previous attempt failed: The plan breaks its rules: session s1 is 120 minutes; a session takes 10 to 90$/,
    );
    expect(topicEvents().map((e) => e.kind)).toEqual(["error"]);
  });
});

// The request text of each recorded first attempt, as briefLines() in architect.ts writes it.
function recordedBriefs(): ArchitectBrief[] {
  const inputs = readdirSync(FIXTURES_DIR).flatMap((name) => {
    const { request } = JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
    const input = request.json?.input;
    const architect =
      request.json?.text?.format?.name === "PlanDraft" && input?.startsWith("Topic: ");
    return architect && !input.includes("\n\nThe previous attempt failed: ") ? [input] : [];
  });
  return inputs.map((input: string) => {
    const [head = "", list = ""] = input.split(
      "\n\nResources (id | language | type | title | why it suits the learner):\n",
    );
    const field = (label: string) =>
      head
        .split("\n")
        .find((line) => line.startsWith(`${label}: `))
        ?.slice(label.length + 2) ?? "";
    const background = field("Background");
    const notes = field("Notes from the interview");
    return {
      topic: field("Topic"),
      goal: field("The learner's goal"),
      level: field("Level") as ArchitectBrief["level"],
      background: background === "not given" ? [] : background.split(", "),
      hours_per_week: Number.parseFloat(field("Weekly time")),
      history_notes: notes === "none" ? "" : notes,
      resources: list.split("\n").map((line) => {
        const [id = "", lang, type, title = "", ...why] = line.split(" | ");
        return { id, lang, type, title, why_ar: why.join(" | ") } as ArchitectBrief["resources"][0];
      }),
    };
  });
}

describe("the topic check on the recordings", () => {
  // A plan the check failed would send a retry request that has no recording.
  it("passes every plan the architect was recorded writing", async () => {
    const briefs = recordedBriefs();
    expect(briefs.length).toBeGreaterThan(0);
    for (const recorded of briefs) {
      const dir = mkdtempSync(join(tmpdir(), "topic-replay-"));
      dirs.push(dir);
      const store = createFileStore(dir);
      const orchestrator = createOrchestrator({
        store,
        makeProvider: (onTrace) =>
          createProvider({ models: loadModels(), profile: "replay", onTrace }),
      });

      await runArchitect({ orchestrator, sessionId: "s1", brief: recorded });

      const checks = store
        .readTrace<TraceEvent>("s1")
        .filter((e) => e.summary_en.startsWith("Topic check"));
      expect(
        checks.map((e) => e.summary_ar),
        recorded.level,
      ).toEqual(["تحقّق من أن خطتك تخص موضوعك"]);
    }
  });
});
