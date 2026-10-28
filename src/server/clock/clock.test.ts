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
    expect(events.map((e) => [e.agent, e.sim_ts, e.summary_en])).toEqual([
      ["clock", "day 1 09:00", "Clock advanced from day 0 09:00 to day 1 09:00"],
      ["clock", "day 10 09:00", "Clock set from day 1 09:00 to day 10 09:00"],
      ["clock", "day 0 09:00", "Clock reset to day 0 09:00"],
    ]);
    for (const e of events) expect(e.summary_ar).toMatch(/[؀-ۿ]/);
  });
});

describe("tracer", () => {
  it("stamps every event with the session's sim time, or the time it names", () => {
    const { store, open } = setup();
    open().set(2);
    const tracer = createTracer(store, "s_1");

    const now = tracer.emit({ agent: "scout", kind: "decision", summary_ar: "س", summary_en: "s" });
    const caughtUp = tracer.emit({
      agent: "scheduler",
      kind: "decision",
      summary_ar: "س",
      summary_en: "s",
      at: { day: 1, minute: 19 * 60 },
    });

    expect(now.sim_ts).toBe("day 2 09:00");
    expect(caughtUp.sim_ts).toBe("day 1 19:00");
    expect(Date.parse(now.ts)).not.toBeNaN();
  });

  it("continues ids from the stored trace when two tracers write one session", () => {
    const { store } = setup();
    const first = createTracer(store, "s_1");
    const second = createTracer(store, "s_1");
    const event = { agent: "scout", kind: "decision", summary_ar: "س", summary_en: "s" } as const;

    const ids = [first.emit(event).id, second.emit(event).id, first.emit(event).id];

    expect(ids).toEqual(["evt_0001", "evt_0002", "evt_0003"]);
  });
});
