import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { contentHash, createFileStore } from "../../server/store/store";
import { latestPlan } from "./course";
import { courseLessons, currentLesson, lessonTabTitle, planKind } from "./lessons";

describe("planKind", () => {
  const seed = loadOmarSeed("x");
  const learner = { ...seed.profile, id: "l_new", name: "سارة" };
  const store = () => createFileStore(mkdtempSync(join(tmpdir(), "plan-kind-")));
  const planned = (forProfile: string) => ({
    for_profile: forProfile,
    versions: seed.plans,
    resources: seed.resources,
    limits: { budget_minutes: 300, resource_ids: [] },
    pending: null,
  });

  it("is the seed's sample before the intake", () => {
    expect(planKind(store(), "s1")).toBe("sample");
  });

  it("is none after the intake until the learner's plan is built", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);

    expect(planKind(s, "s1")).toBe("none");
    // A plan built for the seed's learner is not this learner's.
    s.writeDoc("s1", "plan", planned(contentHash(seed.profile)));
    expect(planKind(s, "s1")).toBe("none");
  });

  it("is the learner's own once their plan is built", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);
    s.writeDoc("s1", "plan", planned(contentHash(learner)));

    expect(planKind(s, "s1")).toBe("own");
  });
});

// The seed's plan: L1 in module 1 (sessions on days 0 and 3), L2 in module 2 (days 8 and 10).
const plan = () => {
  const p = latestPlan(loadOmarSeed("x"));
  if (!p) throw new Error("the seed has no plan");
  return p;
};

describe("courseLessons", () => {
  it("opens only the first lesson before any quiz, each lesson in its place in the plan", () => {
    const lessons = courseLessons(plan(), new Set(["L1"]), []);

    expect(lessons).toMatchObject([
      { position: 0, written: true, open: true, passed: false, best: undefined },
      { position: 1, written: false, open: false, passed: false, best: undefined },
    ]);
    expect(lessons.map((l) => l.planned.id)).toEqual(["L1", "L2"]);
    expect(lessons.map((l) => [l.session?.day, l.module?.index])).toEqual([
      [0, 0],
      [8, 1],
    ]);
  });

  it("keeps the next lesson shut below the gate, with the best score so far", () => {
    const mastery = [{ lesson_id: "L1", best_score: 0.75, passed: false, attempts: 1 }];

    const [first, second] = courseLessons(plan(), new Set(["L1"]), mastery);

    expect(first).toMatchObject({ open: true, passed: false, best: 0.75 });
    expect(second).toMatchObject({ open: false });
  });

  it("opens the next lesson, written or not, once the one before is passed", () => {
    const mastery = [{ lesson_id: "L1", best_score: 1, passed: true, attempts: 2 }];

    const [first, second] = courseLessons(plan(), new Set(["L1"]), mastery);

    expect(first).toMatchObject({ open: true, passed: true, best: 1 });
    expect(second).toMatchObject({ open: true, written: false, passed: false });
  });
});

describe("currentLesson", () => {
  it("is the first open lesson not passed yet", () => {
    const passedFirst = [{ lesson_id: "L1", best_score: 1, passed: true, attempts: 1 }];

    expect(currentLesson(courseLessons(plan(), new Set(), []))?.planned.id).toBe("L1");
    expect(currentLesson(courseLessons(plan(), new Set(), passedFirst))?.planned.id).toBe("L2");
  });

  it("stays on the last lesson once every lesson is passed", () => {
    const mastery = ["L1", "L2"].map((id) => ({
      lesson_id: id,
      best_score: 0.9,
      passed: true,
      attempts: 1,
    }));

    expect(currentLesson(courseLessons(plan(), new Set(), mastery))?.planned.id).toBe("L2");
  });
});

describe("lessonTabTitle", () => {
  it("numbers each lesson's page and its quiz's, so no two tabs share a title", () => {
    const lessons = courseLessons(plan(), new Set(["L1"]), []);
    const titles = ["L1", "L2"].flatMap((id) =>
      (["lesson", "quiz"] as const).map((page) => lessonTabTitle(lessons, id, page)),
    );

    expect(titles).toEqual([
      "الدرس الأول",
      "اختبار الدرس الأول",
      "الدرس الثاني",
      "اختبار الدرس الثاني",
    ]);
  });

  it("names a lesson outside the plan, or before there is one, without a number", () => {
    const lessons = courseLessons(plan(), new Set(), []);

    expect(lessonTabTitle(lessons, "L9", "lesson")).toBe("الدرس");
    expect(lessonTabTitle(undefined, "L1", "quiz")).toBe("اختبار الدرس");
  });
});
