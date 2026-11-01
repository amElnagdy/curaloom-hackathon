import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WAITS_FOR_PLAN } from "../_shell/use-sim-clock.ts";
import { ClockControls } from "./clock-controls.tsx";

// The clock as useSimClock gives it once the trace has replayed: day 0, 09:00.
const clock = vi.hoisted(() => ({
  now: { day: 0, minute: 540 },
  busy: false,
  move: async () => ({ kind: "failed" as const }),
  waitsForPlan: false,
}));
vi.mock(import("../_shell/use-sim-clock.ts"), async (original) => ({
  ...(await original()),
  useSimClock: () => clock,
}));

// The opening tag of the fieldset a setting row labels, and of the reset button.
const fieldset = (html: string, labelId: string) =>
  html.match(new RegExp(`<fieldset[^>]*aria-labelledby="${labelId}"[^>]*>`))?.[0] ?? "";
const resetButton = (html: string) =>
  html.match(/<button[^>]*>(?:(?!<\/button>).)*إعادة الضبط<\/button>/s)?.[0] ?? "";

describe("Settings' clock controls", () => {
  beforeEach(() => {
    clock.waitsForPlan = false;
  });

  it("move the clock with a plan, or on the seed's sample", () => {
    const html = renderToStaticMarkup(<ClockControls sessionId="demo" />);

    expect(fieldset(html, "clock-now")).not.toContain("disabled");
    expect(fieldset(html, "clock-jump")).not.toContain("disabled");
    expect(html).not.toContain(WAITS_FOR_PLAN);
  });

  it("keep the hour, the day and the day list off until the learner's plan, and say why", () => {
    clock.waitsForPlan = true;

    const html = renderToStaticMarkup(<ClockControls sessionId="demo" />);

    expect(fieldset(html, "clock-now")).toContain('disabled=""');
    expect(fieldset(html, "clock-jump")).toContain('disabled=""');
    expect(fieldset(html, "clock-jump")).toContain('aria-describedby="clock-waits"');
    expect(html).toMatch(new RegExp(`id="clock-waits"[^]*${WAITS_FOR_PLAN}`));
    expect(resetButton(html)).not.toContain("disabled");
  });
});
