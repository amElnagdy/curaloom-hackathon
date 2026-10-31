import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CoursePlan,
  type PlanChange,
  REPLAN_REASONS,
  type Resource,
} from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { contentHash, createFileStore } from "../../store/store.ts";
import { createTracer, type TraceEvent } from "../../trace/trace.ts";
import { proposeReplan, type SavedPlan, savedPlan } from "./architect.ts";
import {
  lighterCap,
  lighterWeek,
  noteViolations,
  type ReplanFacts,
  type ReplanRequest,
  replan,
  replanBrief,
  replanViolations,
  switchCandidates,
  templateNote,
} from "./replan.ts";
import { type Limits, planViolations, weekMinutes } from "./rules.ts";

type Session = CoursePlan["committed"]["sessions"][number];

// The plan the intake's recorded run builds for Omar (Wonder fixture 20961da2): six lessons and 13
// sessions in two weeks of 140 and 175 minutes, on an 8-week road, for 300 minutes a week.
const L1_SOURCES = ["r_c167a216", "r_c61a1e51", "r_19cfaa64"];
const L2_SOURCES = ["r_9109c80f", "r_8babb86b"];
const study = (
  id: string,
  lesson_id: string,
  day: number,
  minutes: number,
  resource_ids: string[],
): Session => ({ id, day, minutes, lesson_id, resource_ids, kind: "study" });
const RECORDED: CoursePlan = {
  id: "plan_recorded",
  road: [
    { module: "الأساسيات: فهم إكسل ومفهوم الجدول المحوري", weeks: 1 },
    { module: "إنشاء الجدول المحوري الأول وتحليل نتائجه", weeks: 1 },
    { module: "التصفية والفرز والتجميع لاستكشاف البيانات بعمق", weeks: 2 },
    { module: "تنسيق الجداول المحورية وبناء الرسوم المحورية لعرض النتائج", weeks: 2 },
    { module: "مشروع عملي: تحليل بيانات محاسبية وبناء ملف أعمالك الأول", weeks: 2 },
  ],
  committed: {
    start: "day0",
    weeks: 2,
    lessons: [
      { id: "L1", title_ar: "التعرف على بيئة إكسل وجداول البيانات", module: 0 },
      { id: "L2", title_ar: "ما الجدول المحوري ولماذا يستخدمه محلل البيانات", module: 0 },
      { id: "L3", title_ar: "فهم توزيع البيانات قبل تلخيصها", module: 0 },
      { id: "L4", title_ar: "إنشاء جدولك المحوري الأول خطوة بخطوة", module: 1 },
      { id: "L5", title_ar: "تلخيص البيانات بالصفوف والأعمدة", module: 1 },
      { id: "L6", title_ar: "قراءة نتائج الجدول المحوري وربطها ببيانات المحاسبة", module: 1 },
    ],
    sessions: [
      study("s1", "L1", 0, 25, L1_SOURCES),
      study("s2", "L1", 1, 25, L1_SOURCES),
      study("s3", "L2", 2, 25, L2_SOURCES),
      study("s4", "L2", 3, 20, L2_SOURCES),
      study("s5", "L3", 4, 25, ["r_df4da75d"]),
      study("s6", "L3", 5, 20, ["r_df4da75d"]),
      study("s7", "L4", 7, 30, ["r_8f7bbb8e"]),
      study("s8", "L4", 8, 25, ["r_8f7bbb8e"]),
      study("s9", "L4", 9, 25, ["r_8f7bbb8e"]),
      study("s10", "L5", 10, 25, ["r_43e79caf"]),
      study("s11", "L5", 11, 25, ["r_43e79caf"]),
      study("s12", "L6", 12, 25, ["r_8babb86b", "r_df4da75d"]),
      study("s13", "L6", 13, 20, ["r_8babb86b", "r_df4da75d"]),
    ],
  },
  rationale_ar: "جلسات قصيرة لأنك تركت دورات طويلة من قبل.",
  version: 1,
  reason: "initial",
  diff: [],
  explanation_ar: null,
};

// The scout's eight recorded resources, all verified and open.
const resource = (id: string, lang: Resource["lang"], score: number): Resource => ({
  id,
  url: `https://example.org/${id}`,
  title: id,
  lang,
  licence: {
    spdx: "CC-BY-SA-4.0",
    use: "open",
    evidence_url: `https://example.org/${id}/licence`,
    quote: "CC BY-SA 4.0",
    verified: true,
  },
  type: "article",
  citations: [],
  score,
  why_ar: "مصدر مفتوح",
});
const RESOURCES = [
  resource("r_8babb86b", "ru", 0.95),
  resource("r_43e79caf", "fr", 0.95),
  resource("r_8f7bbb8e", "en", 0.94),
  resource("r_9109c80f", "en", 0.85),
  resource("r_c167a216", "ru", 0.77),
  resource("r_19cfaa64", "fr", 0.77),
  resource("r_c61a1e51", "fr", 0.71),
  resource("r_df4da75d", "fr", 0.61),
];
const LIMITS: Limits = { budget_minutes: 300, resource_ids: RESOURCES.map((r) => r.id) };

// Omar back on day 10 with L1 passed.
const facts = (change: Partial<ReplanFacts> = {}): ReplanFacts => ({
  today: 10,
  passed: new Set(["L1"]),
  reason: "comeback",
  review_lesson: null,
  switch_to: null,
  ...change,
});
const replanned = (f: ReplanFacts, active = RECORDED): CoursePlan => {
  const result = replan(active, RECORDED, LIMITS, f);
  if (!result.ok) throw new Error(`no re-plan: ${result.why.map((v) => v.en).join("; ")}`);
  return result.plan;
};
const rows = (plan: CoursePlan) =>
  plan.committed.sessions.map((s) => [s.id, s.lesson_id, s.day, s.minutes, s.kind]);

// The demo: a shrink, then a recap of 3 out of 5, below the gate, so L1 gets a review.
const DEMO = facts({ reason: "shrink", review_lesson: "L1" });
const DEMO_REQUEST: ReplanRequest = {
  reason: "shrink",
  today: 10,
  away_days: 10,
  recap: { below_gate: true, review_lesson: "L1" },
};
// What the explanation's brief takes from outside the plans: the scout's resources and the notes
// from Omar's interview.
const CONTEXT = {
  resources: RESOURCES,
  history_notes: "ترك دورات إلكترونية من قبل؛ طلب ألا تصله رسائل صباحًا",
};

describe("lighterCap", () => {
  it("is 60% of the lightest week of the first version, 140 minutes", () => {
    expect(weekMinutes(RECORDED)).toEqual([140, 175]);
    expect(lighterCap(RECORDED)).toBe(84);
  });
});

describe("replan, the demo's shrink with a recap below the gate", () => {
  const plan = replanned(DEMO);

  it("keeps L1's sessions, reviews L1 first, then moves and shortens the rest", () => {
    expect(rows(plan)).toEqual([
      ["s1", "L1", 0, 25, "study"],
      ["s2", "L1", 1, 25, "study"],
      ["s14", "L1", 10, 15, "review"],
      ["s3", "L2", 12, 15, "study"],
      ["s4", "L2", 14, 10, "study"],
      ["s5", "L3", 16, 15, "study"],
      ["s6", "L3", 18, 10, "study"],
      ["s7", "L4", 21, 15, "study"],
      ["s8", "L4", 22, 15, "study"],
      ["s9", "L4", 23, 15, "study"],
      ["s10", "L5", 24, 15, "study"],
      ["s11", "L5", 25, 15, "study"],
      ["s12", "L6", 26, 15, "study"],
      ["s13", "L6", 27, 10, "study"],
    ]);
    expect(plan.committed.sessions.find((s) => s.id === "s14")?.resource_ids).toEqual(L1_SOURCES);
  });

  it("makes the lighter week 55 minutes, under the cap of 84", () => {
    expect(lighterWeek(plan, 10)).toBe(55);
  });

  it("grows the first module to 3 weeks and commits to 4 weeks from day 10", () => {
    expect(plan.road.map((step) => step.weeks)).toEqual([3, 1, 2, 2, 2]);
    expect(plan.committed).toMatchObject({ start: "day10", weeks: 4 });
    expect(weekMinutes(plan)).toEqual([50, 30, 35, 100]);
  });

  it("is the next version of the same plan, within every plan rule", () => {
    expect(plan).toMatchObject({
      id: RECORDED.id,
      version: 2,
      reason: "shrink",
      explanation_ar: null,
    });
    expect(planViolations(plan, LIMITS)).toEqual([]);
  });

  it("lists 24 changes: the review, 11 moves, 11 shortens and the longer module", () => {
    const count = (op: PlanChange["op"]) => plan.diff.filter((c) => c.op === op).length;

    expect(plan.diff).toHaveLength(24);
    expect(plan.diff[0]).toEqual({
      op: "review",
      session: "s14",
      lesson: "L1",
      day: 10,
      minutes: 15,
    });
    expect(plan.diff).toContainEqual({ op: "move", session: "s3", from: 2, to: 12 });
    expect(plan.diff).toContainEqual({ op: "shorten", session: "s3", from: 25, to: 15 });
    expect(plan.diff.at(-1)).toEqual({ op: "extend", module: 0, from: 1, to: 3 });
    expect([count("move"), count("shorten")]).toEqual([11, 11]);
  });

  it("gives the same plan for the same facts", () => {
    expect(replanned(DEMO)).toEqual(plan);
  });
});

describe("replan, other returns", () => {
  it("makes the lighter week 50 minutes for a shrink with a recap at the gate, with 23 changes", () => {
    const plan = replanned(facts({ reason: "shrink" }));

    expect(lighterWeek(plan, 10)).toBe(50);
    expect(plan.diff).toHaveLength(23);
    expect(plan.committed.sessions.some((s) => s.kind === "review")).toBe(false);
  });

  it("makes the lighter week 75 minutes for a comeback with a recap below the gate", () => {
    const plan = replanned(facts({ review_lesson: "L1" }));

    expect(lighterWeek(plan, 10)).toBe(75);
    expect(plan.committed.sessions.filter((s) => s.day >= 10 && s.day < 17)).toEqual([
      expect.objectContaining({ kind: "review", minutes: 15 }),
      expect.objectContaining({ minutes: 20 }),
      expect.objectContaining({ minutes: 20 }),
      expect.objectContaining({ minutes: 20 }),
    ]);
  });

  it("makes the lighter week 80 minutes for a return on day 5 after the day-5 offer", () => {
    const plan = replanned(facts({ today: 5, reason: "inactivity_d5" }));

    expect(lighterWeek(plan, 5)).toBe(80);
    expect(plan.committed.start).toBe("day5");
  });

  it("starts L1 on the return day when nothing is passed", () => {
    const plan = replanned(facts({ today: 3, passed: new Set() }));

    expect(plan.committed.sessions.find((s) => s.lesson_id === "L1")?.day).toBe(3);
    expect(planViolations(plan, LIMITS)).toEqual([]);
  });

  it("reviews a lesson passed before its sessions came, and drops those sessions", () => {
    const plan = replanned(facts({ today: 2, passed: new Set(["L1", "L2"]) }));

    expect(plan.diff[0]).toEqual({
      op: "review",
      session: "s14",
      lesson: "L2",
      day: 2,
      minutes: 15,
    });
    expect(plan.diff).toContainEqual({ op: "drop", session: "s3" });
    expect(plan.diff).toContainEqual({ op: "drop", session: "s4" });
    expect(plan.committed.sessions.filter((s) => s.lesson_id === "L2")).toEqual([
      { id: "s14", day: 2, minutes: 15, lesson_id: "L2", resource_ids: L2_SOURCES, kind: "review" },
    ]);
    expect(planViolations(plan, LIMITS)).toEqual([]);
  });

  it("changes nothing when every lesson is passed", () => {
    const passed = new Set(RECORDED.committed.lessons.map((l) => l.id));

    expect(replan(RECORDED, RECORDED, LIMITS, facts({ passed }))).toMatchObject({
      ok: false,
      unchanged: true,
    });
  });

  it("changes nothing in a plan already re-planned for the day", () => {
    const plan = replanned(DEMO);

    expect(replan(plan, RECORDED, LIMITS, facts())).toMatchObject({ ok: false, unchanged: true });
  });
});

describe("replan, a switch", () => {
  const plan = replanned(facts({ reason: "switch", switch_to: "r_43e79caf" }));

  it("gives L2's sessions the new resource, with no shrink", () => {
    const switches = plan.diff.filter((c) => c.op === "switch");

    expect(switches).toEqual([
      { op: "switch", session: "s3", from: L2_SOURCES, to: ["r_43e79caf"] },
      { op: "switch", session: "s4", from: L2_SOURCES, to: ["r_43e79caf"] },
    ]);
    expect(plan.committed.sessions.find((s) => s.id === "s7")?.minutes).toBe(30);
    expect(planViolations(plan, LIMITS)).toEqual([]);
  });

  it("never switches a passed lesson", () => {
    expect(plan.committed.sessions.filter((s) => s.lesson_id === "L1")).toEqual(
      RECORDED.committed.sessions.filter((s) => s.lesson_id === "L1"),
    );
  });
});

describe("switchCandidates", () => {
  it("offers L2 the verified resources it does not use, by score, then open first, then id", () => {
    const sources = RESOURCES.map((r) => {
      if (r.id === "r_43e79caf") return { ...r, licence: { ...r.licence, verified: false } };
      if (r.id === "r_19cfaa64")
        return { ...r, licence: { ...r.licence, use: "personal_study" as const } };
      return r;
    });

    expect(switchCandidates(RECORDED, RESOURCES, "L2").map((r) => r.id)).toEqual([
      "r_43e79caf",
      "r_8f7bbb8e",
      "r_19cfaa64",
      "r_c167a216",
      "r_c61a1e51",
      "r_df4da75d",
    ]);
    expect(switchCandidates(RECORDED, sources, "L2").map((r) => r.id)).toEqual([
      "r_8f7bbb8e",
      "r_c167a216",
      "r_19cfaa64",
      "r_c61a1e51",
      "r_df4da75d",
    ]);
  });
});

describe("replanViolations", () => {
  const plan = replanned(DEMO);
  const withSession = (id: string, change: Partial<Session>): CoursePlan => ({
    ...plan,
    committed: {
      ...plan.committed,
      sessions: plan.committed.sessions.map((s) => (s.id === id ? { ...s, ...change } : s)),
    },
  });

  it("finds nothing wrong with the demo's re-plan", () => {
    expect(replanViolations(plan, RECORDED, DEMO, 84)).toEqual([]);
  });

  it.each([
    ["an L3 session between L2's", withSession("s5", { day: 13 }), /L3.*before L2 ends/],
    [
      "a missed session left before today",
      withSession("s3", { day: 9 }),
      /s3.*day 9.*before day 10/,
    ],
    ["a review after a study session", withSession("s14", { day: 13 }), /review s14.*after/],
    ["a lighter week over the cap", withSession("s3", { minutes: 45 }), /85 minutes.*84/],
    ["a version that skips one", { ...plan, version: 3 }, /version 3 is not .*version 2/],
    ["another plan's id", { ...plan, id: "plan_other" }, /plan_other/],
    ["a kept session changed", withSession("s1", { minutes: 20 }), /s1.*kept/],
  ])("catches %s, in English and Arabic", (_, changed, en) => {
    const violation = replanViolations(changed, RECORDED, DEMO, 84).find((v) => en.test(v.en));

    expect(violation?.ar).toMatch(/\p{Script=Arabic}/u);
  });
});

describe("templateNote", () => {
  it("tells the demo's learner what changed, with the brief's numbers in Arabic digits", () => {
    const brief = replanBrief(
      RECORDED,
      replanned(DEMO),
      RECORDED,
      DEMO_REQUEST,
      DEMO.passed,
      CONTEXT,
    );

    const note = templateNote(brief);

    expect(brief).toMatchObject({
      recap: "low",
      lighter: { from_day: 10, minutes: 55, cap: 84, original_week: 140, percent: 60 },
      missed: 7,
      moved: 11,
      shortened: 11,
      road_weeks: { before: 8, after: 10 },
    });
    for (const fact of [
      "جلسات أقصر",
      "اليوم ١٠",
      "«التعرف على بيئة إكسل وجداول البيانات»",
      "٥٥ دقيقة",
      "٨٤ دقيقة",
      "١٠ أسابيع بدل ٨",
    ]) {
      expect(note).toContain(fact);
    }
  });

  it("claims no review or shorter sessions for a comeback with a good recap", () => {
    const request: ReplanRequest = { ...DEMO_REQUEST, reason: "comeback", recap: null };
    const plan = replanned(facts());

    const note = templateNote(replanBrief(RECORDED, plan, RECORDED, request, DEMO.passed, CONTEXT));

    expect(note).toMatch(/\p{Script=Arabic}/u);
    expect(note).not.toMatch(/مراجعة|أقصر/);
  });
});

describe("replanBrief", () => {
  it("names the module that grew and keeps the interview's notes, with no candidates when nothing switched", () => {
    const brief = replanBrief(
      RECORDED,
      replanned(DEMO),
      RECORDED,
      DEMO_REQUEST,
      DEMO.passed,
      CONTEXT,
    );

    expect(brief.grown).toEqual([
      { module_ar: "الأساسيات: فهم إكسل ومفهوم الجدول المحوري", from: 1, to: 3 },
    ]);
    expect(brief.history_notes).toBe(CONTEXT.history_notes);
    expect(brief.candidates).toEqual([]);
  });

  it("offers a switch's candidates for the current lesson, without their addresses or licences", () => {
    const request: ReplanRequest = { ...DEMO_REQUEST, reason: "switch", recap: null };
    const plan = replanned(facts({ reason: "switch", switch_to: "r_43e79caf" }));

    const brief = replanBrief(RECORDED, plan, RECORDED, request, DEMO.passed, CONTEXT);

    expect(brief.candidates.map((c) => c.id)).toEqual([
      "r_43e79caf",
      "r_8f7bbb8e",
      "r_19cfaa64",
      "r_c167a216",
      "r_c61a1e51",
      "r_df4da75d",
    ]);
    expect(brief.candidates[0]).toEqual({
      id: "r_43e79caf",
      title: "r_43e79caf",
      lang: "fr",
      type: "article",
      why_ar: "مصدر مفتوح",
    });
  });
});

describe("noteViolations", () => {
  const brief = replanBrief(
    RECORDED,
    replanned(DEMO),
    RECORDED,
    DEMO_REQUEST,
    DEMO.passed,
    CONTEXT,
  );
  const note = (explanation_ar: string, resource_id: string | null = null) => ({
    explanation_ar,
    resource_id,
  });

  it("passes a note that says the brief's numbers in Arabic digits", () => {
    const text =
      "عدتَ بعد ١٠ أيام، فجعلنا أسبوعك الأول أخف: ٥٥ دقيقة والحد ٨٤، وتبدأ بمراجعة قصيرة.";

    expect(noteViolations(note(text), brief)).toEqual([]);
  });

  it.each([
    ["a number the brief does not give", "أسبوعك الأول ٧٧ دقيقة.", /77.*brief/],
    ["the same number in Latin digits", "أسبوعك الأول 77 دقيقة.", /77.*brief/],
    ["a web address", "راجع الدرس على example.com قبل جلستك.", /address/],
    ["an emoji", "أهلًا بعودتك 🎉", /emoji/],
    ["a brace", "أهلًا {name}، رتّبنا خطتك.", /brace/],
    ["no Arabic", "Your first week back is lighter.", /no Arabic/],
    ["more than 400 characters", "خطتك أخف الآن. ".repeat(30), /450 characters.*400/],
  ])("refuses %s", (_, text, why) => {
    expect(noteViolations(note(text), brief)).toEqual([expect.stringMatching(why)]);
  });

  it("refuses a resource when the brief offers no switch, and one the switch did not offer", () => {
    const request: ReplanRequest = { ...DEMO_REQUEST, reason: "switch", recap: null };
    const plan = replanned(facts({ reason: "switch", switch_to: "r_43e79caf" }));
    const switched = replanBrief(RECORDED, plan, RECORDED, request, DEMO.passed, CONTEXT);

    expect(noteViolations(note("رتّبنا خطتك.", "r_43e79caf"), brief)).toEqual([
      expect.stringMatching(/null/),
    ]);
    expect(noteViolations(note("رتّبنا خطتك.", "r_9109c80f"), switched)).toEqual([
      expect.stringMatching(/r_9109c80f.*candidates/),
    ]);
    expect(noteViolations(note("رتّبنا خطتك.", "r_8f7bbb8e"), switched)).toEqual([]);
  });
});

describe("proposeReplan, on the recorded plan", () => {
  it("saves the demo's v2 as the proposal and traces it with the plan's numbers", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "replan-")));
    const learner = loadOmarSeed("Excel pivot tables for data analysis").profile;
    store.writeDoc("s1", "plan", {
      for_profile: contentHash(learner),
      versions: [RECORDED],
      resources: RESOURCES,
      limits: LIMITS,
      pending: null,
    } satisfies SavedPlan);
    const tracer = createTracer(store, "s1");

    const proposed = await proposeReplan(
      { store, sessionId: "s1", tracer, profile: learner, steps: null },
      DEMO_REQUEST,
      DEMO.passed,
    );

    expect(proposed).toEqual({ ok: true, version: 2, lighter: { minutes: 55, cap: 84 } });
    expect(savedPlan(store, "s1")).toMatchObject({
      versions: [RECORDED],
      pending: { ...replanned(DEMO), explanation_ar: expect.stringContaining("٥٥ دقيقة") },
    });
    const trace = store.readTrace<TraceEvent>("s1");
    expect(trace[0]?.summary_en).toBe(
      "replan: v2 (shrink): lighter week 55/84 (60% of 140), 7 missed, 11 moved, 11 shortened, review L1 day 10, module 0 1->3 weeks",
    );
    const said = trace.flatMap((e) => [e.summary_ar, e.summary_en]);
    expect(said.filter((t) => t.includes(learner.name) || t.includes(learner.id))).toEqual([]);
  });
});

// Random plans in the shape the architect builds: modules of 1 to 3 weeks, lessons only in the first
// two weeks, sessions of 20 to 45 minutes. A fixed seed keeps the run the same.
function randomPlans(count: number) {
  let state = 7;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const pick = <T>(items: readonly T[]) => items[between(0, items.length - 1)] as T;
  const cases: { plan: CoursePlan; limits: Limits; facts: ReplanFacts }[] = [];
  while (cases.length < count) {
    const road = Array.from({ length: between(1, 5) }, (_, i) => ({
      module: `m${i}`,
      weeks: between(1, 3),
    }));
    const lessons: CoursePlan["committed"]["lessons"] = [];
    const sessions: Session[] = [];
    let from = 0;
    for (const [module, step] of road.entries()) {
      const to = Math.min(from + step.weeks * 7, 14);
      let day = from;
      for (let l = between(1, 3); l > 0 && day < to; l--) {
        const id = `L${lessons.length + 1}`;
        lessons.push({ id, title_ar: id, module });
        for (let s = between(1, 3); s > 0 && day < to; s--) {
          sessions.push(study(`s${sessions.length + 1}`, id, day, between(4, 9) * 5, ["r1"]));
          day += between(1, 2);
        }
      }
      from += step.weeks * 7;
    }
    const plan: CoursePlan = {
      ...RECORDED,
      road,
      committed: { start: "day0", weeks: 2, lessons, sessions },
    };
    const limits = { budget_minutes: between(2, 8) * 60, resource_ids: ["r1", "r2"] };
    if (planViolations(plan, limits).length) continue;
    const passed = lessons.slice(0, between(0, lessons.length)).map((l) => l.id);
    const reason = pick(REPLAN_REASONS);
    const review = passed.length && random() < 0.5 ? pick(passed) : null;
    cases.push({
      plan,
      limits,
      facts: {
        today: between(2, 40),
        passed: new Set(passed),
        reason,
        review_lesson: review,
        switch_to: reason === "switch" ? "r2" : null,
      },
    });
  }
  return cases;
}

describe("replan, on 1,000 random plans", () => {
  it("either changes nothing or makes a plan that keeps every rule", () => {
    const outcomes = randomPlans(1000).map(({ plan, limits, facts }) => {
      const result = replan(plan, plan, limits, facts);
      if (!result.ok)
        return result.unchanged ? "unchanged" : result.why.map((v) => v.en).join("; ");
      const broken = [
        ...planViolations(result.plan, limits),
        ...replanViolations(result.plan, plan, facts, lighterCap(plan)),
      ];
      return broken.length ? broken.map((v) => v.en).join("; ") : "replanned";
    });

    expect(outcomes.filter((o) => o !== "unchanged" && o !== "replanned")).toEqual([]);
    expect(outcomes.filter((o) => o === "replanned").length).toBeGreaterThan(300);
    expect(outcomes.filter((o) => o === "unchanged").length).toBeGreaterThan(100);
  });
});
