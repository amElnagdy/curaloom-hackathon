import { describe, expect, it } from "vitest";
import type { CoursePlan, PlanChange } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { changeLines, changeTally, planDays, sessionChanges } from "./plans.ts";

type Row = [id: string, day: number, lesson: string, minutes: number, kind?: "study" | "review"];

const LESSONS = [
  { id: "L1", title_ar: "التعرف على بيئة إكسل وجداول البيانات", module: 0 },
  { id: "L2", title_ar: "ما الجدول المحوري ولماذا يستخدمه محلل البيانات", module: 0 },
  { id: "L3", title_ar: "فهم توزيع البيانات قبل تلخيصها", module: 0 },
  { id: "L4", title_ar: "إنشاء جدولك المحوري الأول خطوة بخطوة", module: 1 },
  { id: "L5", title_ar: "تلخيص البيانات بالصفوف والأعمدة", module: 1 },
  { id: "L6", title_ar: "قراءة نتائج الجدول المحوري وربطها ببيانات المحاسبة", module: 1 },
];

function plan(version: number, start: number, weeks: number, rows: Row[], diff: PlanChange[] = []) {
  return {
    id: "plan_demo",
    road: [
      { module: "الأساسيات", weeks: version === 1 ? 1 : 3 },
      { module: "الجدول المحوري الأول", weeks: 1 },
    ],
    committed: {
      start: `day${start}`,
      weeks,
      lessons: LESSONS,
      sessions: rows.map(([id, day, lesson_id, minutes, kind = "study"]) => ({
        id,
        day,
        minutes,
        lesson_id,
        resource_ids: ["r1"],
        kind,
      })),
    },
    rationale_ar: "",
    version,
    reason: version === 1 ? "initial" : "shrink",
    diff,
    explanation_ar: null,
  } satisfies CoursePlan;
}

// The plan the interviewed Omar gets (the replayed demo): six lessons, two weeks, 13 sessions.
const v1 = plan(1, 0, 2, [
  ["s1", 0, "L1", 25],
  ["s2", 1, "L1", 25],
  ["s3", 2, "L2", 25],
  ["s4", 3, "L2", 20],
  ["s5", 4, "L3", 25],
  ["s6", 5, "L3", 20],
  ["s7", 7, "L4", 30],
  ["s8", 8, "L4", 25],
  ["s9", 9, "L4", 25],
  ["s10", 10, "L5", 25],
  ["s11", 11, "L5", 25],
  ["s12", 12, "L6", 25],
  ["s13", 13, "L6", 20],
]);

// Day 10, lesson 1 passed on a retry, «جلسات أقصر»: a review first, a lighter week of 55 minutes
// against the cap of 84, every session not passed moved and shortened, and the first module three
// weeks long. 24 changes.
const moved: [
  session: string,
  lesson: string,
  from: number,
  to: number,
  was: number,
  now: number,
][] = [
  ["s3", "L2", 2, 12, 25, 15],
  ["s4", "L2", 3, 14, 20, 10],
  ["s5", "L3", 4, 16, 25, 15],
  ["s6", "L3", 5, 21, 20, 10],
  ["s7", "L4", 7, 22, 30, 15],
  ["s8", "L4", 8, 23, 25, 15],
  ["s9", "L4", 9, 24, 25, 15],
  ["s10", "L5", 10, 25, 25, 15],
  ["s11", "L5", 11, 26, 25, 15],
  ["s12", "L6", 12, 27, 25, 15],
  ["s13", "L6", 13, 27, 20, 10],
];
const v2 = plan(
  2,
  10,
  4,
  [
    ["s1", 0, "L1", 25],
    ["s2", 1, "L1", 25],
    ["s14", 10, "L1", 15, "review"],
    ...moved.map(([id, lesson, , to, , now]): Row => [id, to, lesson, now]),
  ],
  [
    { op: "review", session: "s14", lesson: "L1", day: 10, minutes: 15 },
    ...moved.flatMap(([session, , from, to, was, now]): PlanChange[] => [
      { op: "move", session, from, to },
      { op: "shorten", session, from: was, to: now },
    ]),
    { op: "extend", module: 0, from: 1, to: 3 },
  ],
);

const marks = (days: ReturnType<typeof planDays>) => days.map((d) => d.mark);
const tally = (days: ReturnType<typeof planDays>) => {
  const all = days.flatMap((d) => d.sessions);
  return {
    done: all.filter((m) => m === "done").length,
    missed: all.filter((m) => m === "missed").length,
  };
};

describe("planDays", () => {
  it("marks each day of the committed weeks from the sim clock: passed lessons done, the rest missed before today", () => {
    const days = planDays([v1], new Set(["L1"]), 10);

    expect(marks(days)).toEqual([
      "done",
      "done",
      "missed",
      "missed",
      "missed",
      "missed",
      "rest",
      "missed",
      "missed",
      "missed",
      "due",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(days.map((d) => d.today)).toEqual(days.map((d) => d.day === 10));
    expect(tally(days)).toEqual({ done: 2, missed: 7 });
  });

  it("keeps the days before a re-plan as the version in force then had them, and lays the rest from the new one", () => {
    const days = planDays([v1, v2], new Set(["L1"]), 10);

    expect(days).toHaveLength(28);
    expect(marks(days).slice(0, 10)).toEqual(
      marks(planDays([v1], new Set(["L1"]), 10)).slice(0, 10),
    );
    expect(marks(days).slice(10)).toEqual([
      "due",
      "rest",
      "upcoming",
      "rest",
      "upcoming",
      "rest",
      "upcoming",
      "rest",
      "rest",
      "rest",
      "rest",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(days.slice(10, 17).reduce((sum, d) => sum + d.minutes, 0)).toBe(55);
    expect(days[27]).toMatchObject({ minutes: 25, sessions: ["upcoming", "upcoming"] });
    expect(tally(days)).toEqual({ done: 2, missed: 7 });
  });

  it("counts a past review of a passed lesson as done and a session of a lesson not passed as missed", () => {
    const days = planDays([v1, v2], new Set(["L1"]), 13);

    expect(days[10]?.mark).toBe("done");
    expect(days[12]?.mark).toBe("missed");
    expect(days[13]).toMatchObject({ mark: "rest", today: true });
  });

  it("counts today's study session of a passed lesson as done, and today's review as still due", () => {
    expect(planDays([v1], new Set(["L1"]), 1)[1]?.mark).toBe("done");
    expect(planDays([v1, v2], new Set(["L1"]), 10)[10]?.mark).toBe("due");
  });

  it("shows the seed's plan on day 0 with nothing missed", () => {
    const seed = loadOmarSeed("x");

    const days = planDays(seed.plans, new Set(), 0);

    expect(days).toHaveLength(14);
    expect(days.flatMap((d) => (d.mark === "rest" ? [] : [[d.day, d.mark]]))).toEqual([
      [0, "due"],
      [3, "upcoming"],
      [8, "upcoming"],
      [10, "upcoming"],
    ]);
  });
});

describe("changeLines", () => {
  it("has nothing to say for the first version", () => {
    expect(changeLines(v1)).toEqual([]);
  });

  it("says what a re-plan changed in a few lines, in Arabic, from its diff", () => {
    expect(v2.diff).toHaveLength(24);

    expect(changeLines(v2)).toEqual([
      "أُضيفت مراجعة لدرس «التعرف على بيئة إكسل وجداول البيانات» في اليوم ١٠، مدتها ١٥ دقيقة",
      "نُقلت ١١ جلسة إلى ما بين اليوم ١٢ واليوم ٢٧",
      "قُصّرت ١١ جلسة، ومجموعها الآن ١٥٠ دقيقة بدل ٢٦٥",
      "صار للوحدة الأولى ٣ أسابيع، وكان لها أسبوع واحد",
    ]);
  });

  it("names the days and minutes of a single change, as a learner's edit makes", () => {
    const edit = (diff: PlanChange[]) =>
      changeLines({ ...v1, version: 2, reason: "learner_edit", diff });

    expect(edit([{ op: "move", session: "s3", from: 2, to: 4 }])).toEqual([
      "نُقلت جلسة واحدة من اليوم ٢ إلى اليوم ٤",
    ]);
    expect(edit([{ op: "move", session: "s1", from: 0, to: 1 }])).toEqual([
      "نُقلت جلسة واحدة من يوم البدء إلى اليوم ١",
    ]);
    expect(edit([{ op: "shorten", session: "s3", from: 25, to: 10 }])).toEqual([
      "قُصّرت جلسة واحدة من ٢٥ إلى ١٠ دقائق",
    ]);
  });

  it("counts moves to one day, dropped sessions and switched sources", () => {
    const lines = changeLines({
      ...v2,
      diff: [
        { op: "move", session: "s3", from: 2, to: 12 },
        { op: "move", session: "s4", from: 3, to: 12 },
        { op: "switch", session: "s3", from: ["r1"], to: ["r2"] },
        { op: "switch", session: "s4", from: ["r1"], to: ["r2"] },
        { op: "switch", session: "s5", from: ["r1"], to: ["r2"] },
        { op: "drop", session: "s6" },
        { op: "drop", session: "s7" },
      ],
    });

    expect(lines).toEqual([
      "نُقلت جلستان إلى اليوم ١٢",
      "انتقلت ٣ جلسات إلى مصدر آخر",
      "حُذفت جلستان",
    ]);
  });
});

describe("sessionChanges", () => {
  it("gives the review, then one line per session of the version before with a tag per change, then the longer module", () => {
    const changes = sessionChanges(v1, v2);

    expect(changes.slice(0, 3)).toEqual([
      {
        text: "جلسة مراجعة جديدة للدرس الأول في اليوم ١٠، ١٥ دقيقة",
        tags: ["review"],
      },
      {
        text: "جلسة الدرس الثاني في اليوم ٢ صارت في اليوم ١٢، و١٥ دقيقة بدل ٢٥",
        tags: ["move", "shorten"],
      },
      {
        text: "جلسة الدرس الثاني في اليوم ٣ صارت في اليوم ١٤، و١٠ دقائق بدل ٢٠",
        tags: ["move", "shorten"],
      },
    ]);
    expect(changes.at(-1)).toEqual({
      text: "صارت الوحدة الأولى ٣ أسابيع بدل أسبوع واحد",
      tags: ["extend"],
    });
    expect(changes).toHaveLength(13);
    expect(changes.flatMap((c) => c.tags)).toHaveLength(v2.diff.length);
  });

  it("names a change alone, a dropped session and a switched source", () => {
    const changes = sessionChanges(v1, {
      ...v2,
      diff: [
        { op: "shorten", session: "s3", from: 25, to: 15 },
        { op: "switch", session: "s4", from: ["r1"], to: ["r2"] },
        { op: "move", session: "s5", from: 4, to: 16 },
        { op: "switch", session: "s5", from: ["r1"], to: ["r2"] },
        { op: "drop", session: "s2" },
      ],
    });

    expect(changes).toEqual([
      { text: "جلسة الدرس الأول في اليوم ١ حُذفت", tags: ["drop"] },
      { text: "جلسة الدرس الثاني في اليوم ٢ صارت ١٥ دقيقة بدل ٢٥", tags: ["shorten"] },
      { text: "جلسة الدرس الثاني في اليوم ٣ صارت من مصدر آخر", tags: ["switch"] },
      {
        text: "جلسة الدرس الثالث في اليوم ٤ صارت في اليوم ١٦، ومن مصدر آخر",
        tags: ["move", "switch"],
      },
    ]);
  });
});

describe("changeTally", () => {
  it("counts a version's changes by kind", () => {
    expect(changeTally(v2.diff)).toBe("٢٤ تغييرًا: مراجعة واحدة، و١١ نقلًا، و١١ تقصيرًا، وتمديد وحدة");
  });

  it("counts a few changes, dropped sessions and switched sources", () => {
    expect(
      changeTally([
        { op: "move", session: "s3", from: 2, to: 12 },
        { op: "move", session: "s4", from: 3, to: 12 },
        { op: "switch", session: "s3", from: ["r1"], to: ["r2"] },
        { op: "drop", session: "s6" },
        { op: "drop", session: "s7" },
        { op: "drop", session: "s8" },
      ]),
    ).toBe("٦ تغييرات: نقلان، وتبديل مصدر جلسة، وحذف ٣ جلسات");
  });
});
