import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { readInbox } from "../notifier/adapters";
import { createFileStore } from "../store/store";
import type { TraceEvent } from "../trace/trace";
import type { CoachRule, RuleSource } from "./scheduler";
import { createSim } from "./sim";
import type { SimTime } from "./time";

const at = (day: number, hour: number): SimTime => ({ day, minute: hour * 60 });
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A rule whose message is its key; at 09:00 the seed's quiet hours (22:00 to 12:00) hold it.
function rule(key: string, when: SimTime, write = async () => `رسالة ${key}`): CoachRule {
  return {
    key,
    at: when,
    type: "nudge",
    template: `t_${key}`,
    cta: null,
    why: { ar: `سبب ${key}`, en: `why ${key}` },
    write,
  };
}

// Lists every rule, due or not, as a source may: the scheduler fires only the due ones.
const all =
  (rules: CoachRule[]): RuleSource =>
  () =>
    rules;

function setup(rules: RuleSource) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "scheduler-")));
  const seed = loadOmarSeed("x");
  // A new sim per call, like one per HTTP request.
  const sim = () => createSim({ store, sessionId: "s_1", seed, rules });
  const trace = () => store.readTrace<TraceEvent>("s_1");
  return { store, seed, sim, trace };
}

const ids = (events: { id: string }[]) => events.map((e) => e.id);

describe("coach scheduler", () => {
  it("fires each due rule once, in time order, whatever order the source lists them", async () => {
    const { sim } = setup(
      all([rule("late", at(4, 13)), rule("early", at(1, 13)), rule("middle", at(3, 13))]),
    );

    const jump = await sim().set(4);
    const repeat = await sim().set(4);
    const after = await sim().advance({ minutes: 4 * 60 });

    expect(jump.now).toBe("day 4 09:00");
    expect(ids(jump.events)).toEqual(["early", "middle"]);
    expect(repeat.events).toEqual([]);
    expect(ids(after.events)).toEqual(["late"]);
  });

  it("fires each rule once when the clock moves a day at a time", async () => {
    const { sim } = setup(all([rule("a", at(2, 9)), rule("b", at(5, 9)), rule("c", at(5, 13))]));

    const fired = [];
    for (let day = 1; day <= 6; day++) fired.push(...(await sim().advance({ days: 1 })).events);

    expect(ids(fired)).toEqual(["a", "b", "c"]);
  });

  it("keeps time order when an earlier rule takes longer to write", async () => {
    const { store, sim } = setup(
      all([
        rule("slow", at(1, 13), async () => {
          await later(30);
          return "بطيئة";
        }),
        rule("fast", at(2, 13), async () => "سريعة"),
      ]),
    );

    const jump = await sim().set(3);

    expect(ids(jump.events)).toEqual(["slow", "fast"]);
    expect(readInbox(store, "s_1").map((e) => [e.id, e.text])).toEqual([
      ["slow", "بطيئة"],
      ["fast", "سريعة"],
    ]);
  });

  it("builds each event and message from its rule and the written text", async () => {
    const { store, sim } = setup(all([rule("r1", at(2, 13), async () => "مرحبًا")]));

    const [event] = (await sim().set(3)).events;

    expect(event).toEqual({
      id: "r1",
      sim_day: 2,
      type: "nudge",
      channel: "simulated",
      message_ar: "مرحبًا",
      status: "sent",
    });
    expect(readInbox(store, "s_1")).toEqual([
      {
        id: "r1",
        direction: "out",
        text: "مرحبًا",
        cta: null,
        template: "t_r1",
        sim_ts: "day 2 13:00",
      },
    ]);
  });

  it("traces each rule with its reason, at its own time, with held messages delivered between", async () => {
    const { sim, trace } = setup(all([rule("a", at(2, 9)), rule("b", at(5, 9))]));

    await sim().set(5);

    expect(
      trace().map((e) => [e.agent, e.sim_ts, e.agent === "scheduler" ? e.summary_en : null]),
    ).toEqual([
      ["clock", "day 5 09:00", null],
      ["scheduler", "day 2 09:00", "why a"],
      ["notifier", "day 2 09:00", null],
      ["notifier", "day 2 12:00", null],
      ["scheduler", "day 5 09:00", "why b"],
      ["notifier", "day 5 09:00", null],
    ]);
    expect(trace().find((e) => e.agent === "scheduler")?.summary_ar).toBe("سبب a");
  });

  it("restores the seeded state on reset, so the same jump fires again", async () => {
    const { seed, sim } = setup(all([rule("a", at(2, 13))]));
    await sim().set(3);

    const reset = sim().reset();

    expect(reset).toEqual({ now: "day 0 09:00", events: [] });
    expect(sim().coachEvents()).toEqual(seed.coach_events);
    expect(ids((await sim().set(3)).events)).toEqual(["a"]);
  });

  it("says in the trace that reset restored the seed, including a withdrawn consent", async () => {
    const { seed, sim, trace } = setup(all([]));
    await sim().set(2);
    sim().reply("توقف");

    sim().reset();

    expect(sim().consent()).toEqual(seed.consent);
    const last = trace().at(-1);
    expect(last?.summary_en).toMatch(/reset to the seed.*consent/i);
    expect(last?.summary_ar).toMatch(/الموافقة/);
  });
});
