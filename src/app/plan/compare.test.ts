import { describe, expect, it } from "vitest";
import type { CoursePlan, PlanChange } from "../../../contracts/index.ts";
import { missedSessions, proposalStats, timeline } from "./compare.ts";

type Row = [id: string, day: number, lesson: string, minutes: number, kind?: "study" | "review"];

const LESSONS = ["L1", "L2", "L3", "L4", "L5", "L6"].map((id, i) => ({
  id,
  title_ar: `درس ${i + 1}`,
  module: i < 3 ? 0 : 1,
}));

function plan(version: number, start: number, weeks: number, rows: Row[], diff: PlanChange[] = []) {
  return {
    id: "plan_demo",
    road: [
      { module: "الأساسيات", weeks: version === 1 ? 1 : 3 },
      { module: "الجدول المحوري الأول", weeks: 1 },
      { module: "التصفية", weeks: 2 },
      { module: "التنسيق", weeks: 2 },
      { module: "المشروع", weeks: 2 },
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

// The interviewed Omar's plan in the replayed demo: six lessons in 13 sessions over two weeks.
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

// The re-planner's proposal on day 10, after «جلسات أقصر» and a recap of 3 out of 5: L1 reviewed
// first, every session not passed moved and shortened, the first module three weeks long.
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
  ["s6", "L3", 5, 18, 20, 10],
  ["s7", "L4", 7, 21, 30, 15],
  ["s8", "L4", 8, 22, 25, 15],
  ["s9", "L4", 9, 23, 25, 15],
  ["s10", "L5", 10, 24, 25, 15],
  ["s11", "L5", 11, 25, 25, 15],
  ["s12", "L6", 12, 26, 25, 15],
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

const passed = new Set(["L1"]);
const states = (row: { days: { state: string | null }[] } | undefined) =>
  row?.days.map((d) => d.state ?? "-");

describe("missedSessions", () => {
  it("counts the sessions past their day whose lesson is not passed, and the days they span", () => {
    expect(missedSessions(v1, passed, 10)).toEqual({ count: 7, from: 2, to: 9 });
  });

  it("finds none on the first day, or once every lesson before today is passed", () => {
    expect(missedSessions(v1, new Set(), 0)).toBeNull();
    expect(missedSessions(v1, new Set(["L1", "L2", "L3", "L4"]), 10)).toBeNull();
  });
});

describe("timeline of the plan in force", () => {
  const card = timeline(v1, passed, 10);

  it("marks each day of its committed weeks done, missed or planned, from the sim clock", () => {
    expect(card.days).toBe(14);
    expect(states(card.rows[0])).toEqual([
      ...["done", "done", "missed", "missed", "missed", "missed", "-"],
      ...["missed", "missed", "missed", "plan", "plan", "plan", "plan"],
    ]);
    expect(card.rows).toHaveLength(1);
    expect(card.moves).toEqual([]);
    expect(card.band).toBeNull();
  });

  it("gives each week its minutes, with nothing to compare", () => {
    expect(card.weeks).toEqual([
      { before: 140, after: null },
      { before: 175, after: null },
    ]);
  });
});

describe("timeline of the plan in force over the proposed one", () => {
  const both = timeline(v1, passed, 10, v2);
  const [before, after] = both.rows;

  it("spans the longer commitment: four weeks, with the days the first version never had marked out", () => {
    expect(both.days).toBe(28);
    expect(before?.days.map((d) => d.out)).toEqual([
      ...Array(14).fill(false),
      ...Array(14).fill(true),
    ]);
    expect(after?.days.some((d) => d.out)).toBe(false);
  });

  it("draws the proposal's review on today, its kept sessions done and the rest planned", () => {
    expect(states(after)).toEqual([
      ...["done", "done", "-", "-", "-", "-", "-"],
      ...["-", "-", "-", "review", "-", "plan", "-"],
      ...["plan", "-", "plan", "-", "plan", "-", "-"],
      ...["plan", "plan", "plan", "plan", "plan", "plan", "plan"],
    ]);
    expect(after?.days.map((d) => d.minutes).slice(10, 17)).toEqual([15, 0, 15, 0, 10, 0, 15]);
  });

  it("bands the lighter week from the proposal's start, on the proposal's row only", () => {
    expect(both.band).toEqual({ from: 10, to: 16 });
    expect(after?.days.flatMap((d) => (d.band ? [d.day] : []))).toEqual([
      10, 11, 12, 13, 14, 15, 16,
    ]);
    expect(before?.days.some((d) => d.band)).toBe(false);
  });

  it("gives each moved session its old and new day, and says which ones the learner missed", () => {
    expect(both.moves).toHaveLength(11);
    expect(both.moves[0]).toEqual({ session: "s3", from: 2, to: 12, missed: true });
    expect(both.moves.filter((m) => m.missed).map((m) => m.session)).toEqual([
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
      "s9",
    ]);
  });

  it("sets each week's minutes before and after, before only where the first version had the week", () => {
    expect(both.weeks).toEqual([
      { before: 140, after: 50 },
      { before: 175, after: 30 },
      { before: null, after: 35 },
      { before: null, after: 100 },
    ]);
  });
});

describe("proposalStats", () => {
  it("sums up the demo's proposal: the missed sessions moved, the shorter ones and the longer road", () => {
    expect(proposalStats(v1, v2, passed, 10)).toEqual([
      { value: "٧", label: "جلسات فاتتك نُقلت إلى ما بعد اليوم ١٠، ومعها ٤ جلسات بعدها" },
      { value: "١١", label: "جلسة صارت أقصر: ١٥ أو ١٠ دقائق" },
      { value: "١٠ أسابيع", label: "الطريق بدل ٨، لأن الوحدة الأولى صارت ٣ أسابيع" },
    ]);
  });

  it("agrees with two sessions, and leaves out the kinds of change the proposal lacks", () => {
    const two = {
      ...v2,
      road: v1.road,
      diff: [
        { op: "move", session: "s3", from: 2, to: 12 },
        { op: "move", session: "s4", from: 3, to: 14 },
        { op: "shorten", session: "s3", from: 25, to: 15 },
        { op: "switch", session: "s5", from: ["r1"], to: ["r2"] },
      ] satisfies PlanChange[],
    };

    expect(proposalStats(v1, two, passed, 10)).toEqual([
      { value: "٢", label: "جلستان فاتتاك نُقلتا إلى ما بعد اليوم ١٠" },
      { value: "١", label: "جلسة صارت أقصر: ١٥ دقيقة" },
      { value: "١", label: "جلسة انتقلت إلى مصدر آخر" },
    ]);
  });
});
