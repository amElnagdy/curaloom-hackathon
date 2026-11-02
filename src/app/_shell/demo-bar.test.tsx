import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ladderMarks } from "../../server/coach/ladder.ts";
import { DemoBar } from "./demo-bar.tsx";
import { WAITS_FOR_PLAN } from "./use-sim-clock.ts";

// The clock as useSimClock gives it once the trace has replayed: day 0, 09:00.
const clock = vi.hoisted(() => ({
  now: { day: 0, minute: 540 },
  busy: false,
  move: async () => ({ kind: "failed" as const }),
  waitsForPlan: false,
}));
vi.mock(import("./use-sim-clock.ts"), async (original) => ({
  ...(await original()),
  useSimClock: () => clock,
}));

type Button = { attrs: string; text: string };
const buttons = (html: string): Button[] =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map(([, attrs = "", inner = ""]) => ({
    attrs,
    text: inner.replace(/<[^>]+>/g, ""),
  }));
const off = (b: Button | undefined) => b !== undefined && /\sdisabled=""/.test(b.attrs);

function render() {
  const html = renderToStaticMarkup(
    <DemoBar sessionId="demo" learnerName="عمر" marks={ladderMarks()} profile="replay" />,
  );
  const all = buttons(html);
  return {
    html,
    day: all.find((b) => b.text === "قدّم يومًا"),
    reset: all.find((b) => b.text === "إعادة"),
    marks: all.filter((b) => b.attrs.includes("انتقل إلى")),
  };
}

describe("the demo bar's day buttons", () => {
  beforeEach(() => {
    clock.waitsForPlan = false;
  });

  it("move the clock with a plan, or on the seed's sample", () => {
    const { html, day, reset, marks } = render();

    expect(off(day)).toBe(false);
    expect(off(reset)).toBe(false);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some(off)).toBe(false);
    expect(html).not.toContain(WAITS_FOR_PLAN);
  });

  it("stay off between the intake and the learner's plan, and say why", () => {
    clock.waitsForPlan = true;

    const { html, day, reset, marks } = render();

    expect(off(day)).toBe(true);
    expect(marks.every(off)).toBe(true);
    expect(html).toContain(WAITS_FOR_PLAN);
    expect(day?.attrs).toContain(`title="${WAITS_FOR_PLAN}"`);
    // Reset goes back to the start, so it never waits.
    expect(off(reset)).toBe(false);
  });
});

describe("the demo bar's mode badges", () => {
  it("open their explanation on the chip and in the bar, and sit in no other button", () => {
    // With no choice saved, the bar and its chip both render and CSS shows one.
    const { html } = render();
    const targets = [...html.matchAll(/<button[^>]*\spopovertarget="([^"]+)"/gi)].map(
      ([, id]) => id,
    );

    expect(targets).toHaveLength(2);
    for (const id of targets) {
      expect(html).toMatch(new RegExp(`<div[^>]*\\sid="${id}"[^>]*\\spopover="auto"`));
    }
    expect(html).not.toMatch(/<button(?:(?!<\/button>).)*<button/s);
  });
});
