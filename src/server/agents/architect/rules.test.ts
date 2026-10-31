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
      { id: "s1", day: 1, minutes: 40, lesson_id: "L1", resource_ids: ["r_a"], kind: "study" },
      {
        id: "s2",
        day: 4,
        minutes: 40,
        lesson_id: "L1",
        resource_ids: ["r_a", "r_b"],
        kind: "study",
      },
      { id: "s3", day: 8, minutes: 40, lesson_id: "L2", resource_ids: ["r_b"], kind: "study" },
    ],
  },
  rationale_ar: "جلسات قصيرة لأن وقتك ضيق.",
  version: 1,
  reason: "initial",
  diff: [],
  explanation_ar: null,
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
// A review of L1, after L1's module.
const REVIEW: Session = {
  id: "s4",
  day: 9,
  minutes: 15,
  lesson_id: "L1",
  resource_ids: ["r_a", "r_b"],
  kind: "review",
};
const withReview: CoursePlan = {
  ...PLAN,
  committed: { ...PLAN.committed, sessions: [...PLAN.committed.sessions, REVIEW] },
};
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
    [
      "a module in the two weeks with no lesson",
      {
        ...PLAN,
        committed: {
          ...PLAN.committed,
          lessons: [PLAN.committed.lessons[0] as Lesson],
          sessions: PLAN.committed.sessions.slice(0, 2),
        },
      },
      /التلخيص والتصفية.*day 7.*no lesson/,
    ],
    // A reply Wonder once gave: no lesson at all, so nothing to do in the two weeks.
    [
      "a plan with nothing to do in the two weeks",
      {
        ...PLAN,
        road: [{ module: "ИfбэККэ...", weeks: 1_900_000 }],
        committed: { ...PLAN.committed, lessons: [], sessions: [] },
      },
      /day 0.*no lesson/,
    ],
  ])("catches %s, in English for the model and Arabic for the learner", (_, plan, en) => {
    const violation = planViolations(plan, LIMITS).find((v) => en.test(v.en));

    expect(violation?.ar).toMatch(/\p{Script=Arabic}/u);
  });

  // A re-plan (#26) can put a review of a passed lesson after its module's weeks.
  it("lets a review session fall outside its lesson's module", () => {
    expect(planViolations(withReview, LIMITS)).toEqual([]);
  });
});

describe("applyEdit", () => {
  it("moves a session to another day of its module, as a new version", () => {
    const result = applyEdit(PLAN, { op: "move", session_id: "s1", day: 3 }, LIMITS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      id: "plan_1",
      version: 2,
      reason: "learner_edit",
      diff: [{ op: "move", session: "s1", from: 1, to: 3 }],
      explanation_ar: null,
    });
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
    expect(result.ok && result.plan.diff).toEqual([
      { op: "shorten", session: "s3", from: 40, to: 25 },
    ]);
  });

  it("gives an edit of a re-planned version its own change, not the re-plan's", () => {
    const replanned: CoursePlan = {
      ...PLAN,
      version: 2,
      reason: "shrink",
      diff: [{ op: "shorten", session: "s1", from: 60, to: 40 }],
      explanation_ar: "جلسات أقصر بطلبك.",
    };

    const result = applyEdit(replanned, { op: "move", session_id: "s2", day: 5 }, LIMITS);

    expect(result.ok && result.plan).toMatchObject({
      version: 3,
      reason: "learner_edit",
      diff: [{ op: "move", session: "s2", from: 4, to: 5 }],
      explanation_ar: null,
    });
  });

  it("refuses an edit to a review session", () => {
    const result = applyEdit(withReview, { op: "move", session_id: "s4", day: 10 }, LIMITS);

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          en: expect.stringMatching(/s4 is a review/),
          ar: expect.stringMatching(/\p{Script=Arabic}/u),
        },
      ],
    });
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
          { id: "s1", day: 1, minutes: 60, lesson_id: "L1", resource_ids: ["r_a"], kind: "study" },
          { id: "s2", day: 8, minutes: 60, lesson_id: "L1", resource_ids: ["r_a"], kind: "study" },
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
