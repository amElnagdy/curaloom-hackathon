import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { latestPlan } from "./course";
import { courseLessons, currentLesson } from "./lessons";

// The seed's plan: L1 in module 1 (sessions on days 1 and 3), L2 in module 2 (days 8 and 10).
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
      [1, 0],
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
