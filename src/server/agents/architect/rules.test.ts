import { describe, expect, it } from "vitest";
import type { CoursePlan } from "../../../../contracts/index.ts";
import { applyEdit, type Limits, planViolations } from "./rules.ts";

// Week 1 is the first module's, week 2 the second's; the third module comes after the two weeks.
const PLAN: CoursePlan = {
  id: "plan_1",
  road: [
    { module: "فهم الجدول المحوري", weeks: 1 },
    { module: "التلخيص والتصفية", weeks: 1 },
    { module: "مشروع صغير", weeks: 2 },
  ],
  committed: {
    start: "day0",
    weeks: 2,
    lessons: [
      { id: "L1", title_ar: "ما الجدول المحوري", module: 0 },
      { id: "L2", title_ar: "التلخيص بالمجموع", module: 1 },
    ],
    sessions: [
      { id: "s1", day: 1, minutes: 40, lesson_id: "L1", resource_ids: ["r_a"] },
      { id: "s2", day: 4, minutes: 40, lesson_id: "L1", resource_ids: ["r_a", "r_b"] },
      { id: "s3", day: 8, minutes: 40, lesson_id: "L2", resource_ids: ["r_b"] },
    ],
  },
  rationale_ar: "جلسات قصيرة لأن وقتك ضيق.",
  version: 1,
  reason: "initial",
};
const LIMITS: Limits = { budget_minutes: 100, resource_ids: ["r_a", "r_b"] };

type Session = CoursePlan["committed"]["sessions"][number];
type Lesson = CoursePlan["committed"]["lessons"][number];

const withSession = (id: string, change: Partial<Session>): CoursePlan => ({
  ...PLAN,
  committed: {
    ...PLAN.committed,
    sessions: PLAN.committed.sessions.map((s) => (s.id === id ? { ...s, ...change } : s)),
  },
});
const withLessons = (lessons: Lesson[]): CoursePlan => ({
  ...PLAN,
  committed: { ...PLAN.committed, lessons },
});

describe("planViolations", () => {
  it("finds nothing wrong with a plan that keeps every rule", () => {
    expect(planViolations(PLAN, LIMITS)).toEqual([]);
  });

  it.each([
    [
      "a week longer than the learner's time",
      withSession("s2", { minutes: 70 }),
      /week 1.*110.*100/,
    ],
    ["a session with no resource", withSession("s3", { resource_ids: [] }), /s3.*no resource/],
    ["a resource the scout did not find", withSession("s1", { resource_ids: ["r_x"] }), /s1.*r_x/],
    ["a day after the two weeks", withSession("s3", { day: 14 }), /s3.*day 14.*0 to 13/],
    ["a day outside its lesson's module", withSession("s1", { day: 9 }), /s1.*day 9.*days 0 to 6/],
    ["a session too short to teach anything", withSession("s1", { minutes: 5 }), /s1.*5 minutes/],
    ["a session too long for one sitting", withSession("s3", { minutes: 95 }), /s3.*95 minutes/],
    ["a session of a lesson the plan lacks", withSession("s3", { lesson_id: "L9" }), /s3.*L9/],
    [
      "a lesson with no session",
      withLessons([...PLAN.committed.lessons, { id: "L3", title_ar: "درس", module: 1 }]),
      /L3.*no session/,
    ],
    [
      "a lesson in a module the road lacks",
      withLessons([PLAN.committed.lessons[0] as Lesson, { id: "L2", title_ar: "درس", module: 5 }]),
      /L2.*module 5/,
    ],
  ])("catches %s, in English for the model and Arabic for the learner", (_, plan, en) => {
    const violation = planViolations(plan, LIMITS).find((v) => en.test(v.en));

    expect(violation?.ar).toMatch(/\p{Script=Arabic}/u);
  });
});

describe("applyEdit", () => {
  it("moves a session to another day of its module, as a new version", () => {
    const result = applyEdit(PLAN, { op: "move", session_id: "s1", day: 3 }, LIMITS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({ id: "plan_1", version: 2, reason: "learner_edit" });
    expect(result.plan.committed.sessions).toEqual([
      { ...PLAN.committed.sessions[0], day: 3 },
      PLAN.committed.sessions[1],
      PLAN.committed.sessions[2],
    ]);
    expect(PLAN.committed.sessions[0]?.day).toBe(1);
  });

  it("shortens a session", () => {
    const result = applyEdit(PLAN, { op: "shorten", session_id: "s3", minutes: 25 }, LIMITS);

    expect(result.ok && result.plan.committed.sessions[2]).toMatchObject({ id: "s3", minutes: 25 });
  });

  it("refuses a move out of the weeks of the session's module", () => {
    const result = applyEdit(PLAN, { op: "move", session_id: "s1", day: 8 }, LIMITS);

    expect(result).toEqual({
      ok: false,
      violations: [{ en: expect.stringMatching(/s1.*day 8/), ar: expect.any(String) }],
    });
  });

  it("refuses a move that makes a week longer than the learner's time", () => {
    const longModule: CoursePlan = {
      ...PLAN,
      road: [{ module: "الجداول المحورية", weeks: 2 }],
      committed: {
        ...PLAN.committed,
        lessons: [{ id: "L1", title_ar: "درس", module: 0 }],
        sessions: [
          { id: "s1", day: 1, minutes: 60, lesson_id: "L1", resource_ids: ["r_a"] },
          { id: "s2", day: 8, minutes: 60, lesson_id: "L1", resource_ids: ["r_a"] },
        ],
      },
    };

    const result = applyEdit(longModule, { op: "move", session_id: "s2", day: 3 }, LIMITS);

    expect(result.ok || result.violations.map((v) => v.en)).toEqual([
      expect.stringMatching(/week 1.*120/),
    ]);
  });

  it("refuses to make a session longer", () => {
    const result = applyEdit(PLAN, { op: "shorten", session_id: "s1", minutes: 50 }, LIMITS);

    expect(result.ok || result.violations.map((v) => v.en)).toEqual([
      expect.stringMatching(/s1.*50.*not shorter than 40/),
    ]);
  });

  it("refuses an edit to a session the plan does not have", () => {
    const result = applyEdit(PLAN, { op: "move", session_id: "s9", day: 2 }, LIMITS);

    expect(result.ok || result.violations.map((v) => v.en)).toEqual([
      expect.stringMatching(/no session s9/),
    ]);
  });
});
