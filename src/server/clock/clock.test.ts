import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileStore } from "../store/store";
import { createTracer, type TraceEvent } from "../trace/trace";
import { ClockError, createSimClock } from "./clock";
import { formatSimTime, later, parseSimTime } from "./time";

function setup() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "clock-")));
  const open = () => createSimClock(store, "s_1", createTracer(store, "s_1"));
  return { store, open };
}

describe("simulated time", () => {
  it('formats as "day N HH:MM" and parses back', () => {
    expect(formatSimTime({ day: 2, minute: 19 * 60 })).toBe("day 2 19:00");
    expect(parseSimTime("day 17 07:05")).toEqual({ day: 17, minute: 425 });
    expect(() => parseSimTime("day 2 24:00")).toThrow(/HH:MM/);
    expect(() => parseSimTime("2026-10-28T16:00:00Z")).toThrow(/day 2 19:00/);
  });

  it("carries minutes past midnight into the next day", () => {
    expect(later({ day: 2, minute: 23 * 60 }, { minutes: 90 })).toEqual({ day: 3, minute: 30 });
  });
});

describe("sim clock", () => {
  it("starts at day 0 09:00, like the seed", () => {
    const { open } = setup();

    expect(formatSimTime(open().now())).toBe("day 0 09:00");
  });

  it("persists advance, set and reset in the session store", () => {
    const { open } = setup();

    open().advance({ days: 1, minutes: 30 });
    expect(formatSimTime(open().now())).toBe("day 1 09:30");

    open().set(5);
    expect(formatSimTime(open().now())).toBe("day 5 09:00");

    open().reset();
    expect(formatSimTime(open().now())).toBe("day 0 09:00");
  });

  it("only moves forward", () => {
    const { open } = setup();
    open().set(10);

    expect(() => open().set(5)).toThrow(ClockError);
    expect(() => open().advance({ days: -1 })).toThrow(ClockError);
    expect(formatSimTime(open().now())).toBe("day 10 09:00");
  });

  it("traces every move under the clock, in Arabic and English", () => {
    const { store, open } = setup();

    open().advance({ days: 1 });
    open().set(10);
    open().reset();

    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.map((e) => [e.agent, e.summary_en])).toEqual([
      ["clock", "Clock advanced from day 0 09:00 to day 1 09:00"],
      ["clock", "Clock set from day 1 09:00 to day 10 09:00"],
      ["clock", "Clock reset to day 0 09:00"],
    ]);
    for (const e of events) expect(e.summary_ar).toMatch(/[؀-ۿ]/);
  });
});
