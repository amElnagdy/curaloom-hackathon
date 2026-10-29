import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { phoneThread, readInbox } from "../notifier/adapters";
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

  it("traces a jump with the sim time each step happened, in order", () => {
    const { store, sim } = setup();

    sim().set(10);

    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.map((e) => [e.agent, e.sim_ts])).toEqual([
      ["clock", "day 10 09:00"],
      ["scheduler", "day 2 09:00"],
      ["notifier", "day 2 09:00"],
      ["notifier", "day 2 12:00"],
      ["scheduler", "day 5 09:00"],
      ["notifier", "day 5 09:00"],
      ["notifier", "day 5 12:00"],
      ["scheduler", "day 10 09:00"],
      ["notifier", "day 10 09:00"],
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

describe("coach messages through the notifier", () => {
  it("holds each 09:00 message for quiet hours, delivering it at 12:00 as the clock passes", () => {
    const { store, sim } = setup();

    const jump = sim().set(10);
    const phoneAtNine = readInbox(store, "s_1").map((e) => [e.id, e.sim_ts]);
    const later = sim().advance({ minutes: 3 * 60 });

    expect(jump.events.map((e) => [e.id, e.status])).toEqual([
      ["c1", "sent"],
      ["c2", "sent"],
      ["c3", "queued"],
    ]);
    expect(phoneAtNine).toEqual([
      ["c1", "day 2 12:00"],
      ["c2", "day 5 12:00"],
    ]);
    expect(later.events).toEqual([]);
    expect(
      sim()
        .coachEvents()
        .find((e) => e.id === "c3")?.status,
    ).toBe("sent");
    expect(readInbox(store, "s_1").at(-1)).toMatchObject({ id: "c3", sim_ts: "day 10 12:00" });
  });

  it("gives the day 2 nudge its button", () => {
    const { store, sim } = setup();

    sim().set(3);

    expect(readInbox(store, "s_1")[0]?.cta).toEqual({
      label_ar: "ابدأ مهمة ١٠ دقائق",
      action: "open_lesson",
      lesson_id: "L1",
    });
  });

  it("cancels the held message and suppresses later ones once the learner replies توقف", () => {
    const { store, sim } = setup();
    sim().set(10);

    const reply = sim().reply("توقف");
    const after = sim().set(17);

    expect(reply).toEqual({ opted_out: true, confirmed: true });
    expect(
      sim()
        .coachEvents()
        .find((e) => e.id === "c3")?.status,
    ).toBe("suppressed_opt_out");
    expect(after.events.map((e) => [e.id, e.status])).toEqual([["c4", "suppressed_opt_out"]]);
    expect(
      readInbox(store, "s_1")
        .filter((e) => e.direction === "out")
        .map((e) => e.template),
    ).toEqual(["nudge_day2", "checkin_day5", "opt_out_confirmation"]);
  });

  it("shows the phone thread in sim time order, with held and stopped messages", () => {
    const { store, sim } = setup();
    const thread = () =>
      phoneThread(readInbox(store, "s_1"), sim().outbox()).map((item) => [
        item.kind,
        item.at,
        item.kind === "received" ? item.held_from : item.kind === "held" ? item.until : null,
      ]);

    sim().set(10);
    sim().advance({ minutes: 60 });
    sim().reply("سأبدأ غدًا");
    const afterReply = thread();
    sim().reply("توقف");

    expect(afterReply).toEqual([
      ["received", "day 2 12:00", "day 2 09:00"],
      ["received", "day 5 12:00", "day 5 09:00"],
      ["held", "day 10 09:00", "day 10 12:00"],
      ["sent", "day 10 10:00", null],
    ]);
    expect(thread().slice(2)).toEqual([
      ["suppressed", "day 10 09:00", null],
      ["sent", "day 10 10:00", null],
      ["sent", "day 10 10:00", null],
      ["received", "day 10 10:00", null],
    ]);
  });
});
