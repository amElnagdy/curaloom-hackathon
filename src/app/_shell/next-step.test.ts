import { describe, expect, it } from "vitest";
import { nextStep, progressOf } from "./next-step";

describe("nextStep", () => {
  it("sends a learner who has not done the interview to it, not to the example plan", () => {
    expect(progressOf({ sample: true })).toBe("new");
    expect(nextStep("new")).toEqual({ href: "/intake", label: "ابدأ المقابلة" });
  });

  it("sends a learner whose plan is being built, or could not be, to the plan page, which is not theirs yet", () => {
    expect(progressOf(undefined)).toBe("planning");
    expect(nextStep("planning")).toEqual({ href: "/plan", label: "إلى صفحة الخطة" });
  });

  it("sends a learner with a plan to it", () => {
    expect(progressOf({ sample: false })).toBe("ready");
    expect(nextStep("ready")).toEqual({ href: "/plan", label: "اذهب إلى خطتك" });
  });
});
