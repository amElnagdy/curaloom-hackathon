import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createFileStore } from "../store/store";
import type { TraceEvent } from "../trace/trace";
import { type CoachRule, fillTemplate } from "./scheduler";
import { createSim } from "./sim";
import { startOfDay } from "./time";

function setup(rules?: readonly CoachRule[]) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "scheduler-")));
  const seed = loadOmarSeed("x");
  // A new sim per call, like one per HTTP request.
  const sim = () => createSim({ store, sessionId: "s_1", seed, rules });
  return { store, seed, sim };
}

const keyed = (events: { id: string; sim_day: number }[]) =>
  events.map((e) => `${e.id}@${e.sim_day}`);

describe("coach scheduler", () => {
  it("fires the day 2, 5 and 10 rules in order, once, when the clock jumps to day 10", () => {
    const { sim } = setup();

    const jump = sim().set(10);
    const repeat = sim().set(10);

    expect(jump.now).toBe("day 10 09:00");
    expect(keyed(jump.events)).toEqual(["c1@2", "c2@5", "c3@10"]);
    expect(repeat.events).toEqual([]);
  });

  it("fires each rule once when the clock moves a day at a time", () => {
    const { sim } = setup();

    const fired = Array.from({ length: 17 }, () => sim().advance({ days: 1 }).events).flat();

    expect(keyed(fired)).toEqual(["c1@2", "c2@5", "c3@10", "c4@17"]);
  });

  it("fires in time order whatever the order of the table", () => {
    const rule = (key: string, day: number): CoachRule => ({
      key,
      at: startOfDay(day),
      fire: () => ({
        id: key,
        sim_day: day,
        type: "nudge",
        channel: "simulated",
        message_ar: "تذكير",
        status: "queued",
      }),
    });
    const { sim } = setup([rule("late", 4), rule("early", 1), rule("middle", 3)]);

    expect(
      sim()
        .set(4)
        .events.map((e) => e.id),
    ).toEqual(["early", "middle", "late"]);
  });

  it("puts the learner's name in the Arabic template text", () => {
    const { sim } = setup();

    const [nudge] = sim().set(2).events;

    expect(nudge?.message_ar).toMatch(/^مرحبًا عمر، /);
    expect(() => fillTemplate("{name} و{lesson}", { name: "عمر" })).toThrow(/\{lesson\}/);
  });

  it("stamps each fired rule's trace event with the rule's sim time", () => {
    const { store, sim } = setup();

    sim().set(10);

    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.map((e) => [e.agent, e.sim_ts])).toEqual([
      ["clock", "day 10 09:00"],
      ["scheduler", "day 2 09:00"],
      ["scheduler", "day 5 09:00"],
      ["scheduler", "day 10 09:00"],
    ]);
  });

  it("restores the seeded state on reset, so the same jump fires again", () => {
    const { seed, sim } = setup();
    sim().set(10);

    const reset = sim().reset();

    expect(reset).toEqual({ now: "day 0 09:00", events: [] });
    expect(sim().coachEvents()).toEqual(seed.coach_events);
    expect(keyed(sim().set(10).events)).toEqual(["c1@2", "c2@5", "c3@10"]);
  });
});
