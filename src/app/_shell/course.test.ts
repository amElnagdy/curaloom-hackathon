import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { startOfDay } from "../../server/clock/time";
import { ladderAt } from "../../server/coach/ladder";
import { courseStatus, ladderText, quizState, simDay } from "./course";

const seed = () => loadOmarSeed("x");

describe("quizState", () => {
  it("asks for a retry when the best score is below the gate", () => {
    // The seed: one attempt at 75% on a quiz that passes at 80%.
    expect(quizState(seed(), "L1")).toMatchObject({
      status: "attention",
      label: "أعد المحاولة",
      gate: 0.8,
      best: 0.75,
      tries: 1,
      passed: false,
    });
  });

  it("shows a passed quiz as passed", () => {
    const s = seed();
    s.mastery = [{ lesson_id: "L1", best_score: 0.9, passed: true, attempts: 2 }];

    expect(quizState(s, "L1")).toMatchObject({ status: "ready", passed: true, best: 0.9 });
  });

  it("has no best score before the first attempt", () => {
    const s = seed();
    s.attempts = [];
    s.mastery = [];

    expect(quizState(s, "L1")).toMatchObject({ status: "waiting", tries: 0, best: undefined });
  });

  it("has no state for a lesson without a quiz", () => {
    expect(quizState(seed(), "L9")).toBeUndefined();
  });
});

describe("courseStatus", () => {
  it("names the ready module while later modules still wait", () => {
    // The seed's plan has three modules; only the first has a lesson.
    expect(courseStatus(seed())).toEqual({ status: "ready", label: "الوحدة الأولى جاهزة" });
  });

  it("calls the course ready only when every module has lessons", () => {
    const s = seed();
    const plan = s.plans[0];
    if (!plan) throw new Error("the seed has a plan");
    plan.road = plan.road.slice(0, 1);

    expect(courseStatus(s)).toEqual({ status: "ready", label: "دورتك جاهزة" });
  });

  it("waits while no module has lessons", () => {
    const s = seed();
    s.lessons = [];

    expect(courseStatus(s).status).toBe("waiting");
  });
});

describe("simDay", () => {
  it("names day 0 instead of showing an Arabic-Indic zero", () => {
    expect(simDay(0)).not.toMatch(/٠/);
    expect(simDay(3)).toBe("اليوم ٣");
  });
});

describe("ladderText", () => {
  const facts = { anchor: 0, pause: null, messages_on: true };

  it("names where the coach is and the day of its next message", () => {
    expect(ladderText(ladderAt(facts, startOfDay(5)))).toBe(
      "المدرب عرض عليك أسبوعًا أخف. رسالته التالية في اليوم ١٠.",
    );
  });

  it("gives the end of a pause the learner chose", () => {
    const pause = { anchor: 0, from: startOfDay(10), until: startOfDay(17) };

    expect(ladderText(ladderAt({ ...facts, pause }, startOfDay(12)))).toBe(
      "المدرب في استراحة طلبتها حتى اليوم ١٧، ٩:٠٠ ص.",
    );
  });

  it("names no next message while the messages are off", () => {
    expect(ladderText(ladderAt({ ...facts, messages_on: false }, startOfDay(5)))).toBe(
      "المدرب لا يرسل رسائل.",
    );
  });
});
