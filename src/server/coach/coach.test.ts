import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createSim } from "../clock/sim";
import { readInbox } from "../notifier/adapters";
import { createFileStore } from "../store/store";
import type { TraceEvent } from "../trace/trace";
import { fillTemplate, type Study } from "./coach";
import { sessionSim } from "./session";

const seed = loadOmarSeed("x");

function setup() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
  // A new sim per call, like one per HTTP request.
  const sim = () => sessionSim(store, "s_1", seed).sim;
  const phone = () => readInbox(store, "s_1");
  const trace = () => store.readTrace<TraceEvent>("s_1");
  return { store, sim, phone, trace };
}

const WEEKLY_TEXT = "عمر، مكانك في الدورة محفوظ. عُد متى شئت، وابدأ بمراجعة قصيرة.";
const REVIEW = { label_ar: "مراجعة قصيرة", action: "open_lesson", lesson_id: "L1" };

// The seed's Omar took his last quiz on day 0; his quiet hours run from 22:00 to 12:00.
const DAY_TABLE = [
  {
    day: 2,
    id: "nudge_a0_d2",
    type: "nudge",
    state: "nudged_d2",
    cta: { label_ar: "ابدأ مهمة ١٠ دقائق", action: "open_lesson", lesson_id: "L1" },
    text: "مرحبًا عمر، عشر دقائق اليوم تكفي لتتقدم في درسك. ابدأ بمهمة قصيرة.",
  },
  {
    day: 5,
    id: "replan_a0_d5",
    type: "replan",
    state: "replan_offered_d5",
    cta: { label_ar: "افتح خطتي", action: "open_plan" },
    text: "عمر، يبدو أن أسبوعك مزدحم. يمكن أن نجعله أخف: جلسات أقصر والهدف نفسه. افتح خطتك واختر ما يناسبك.",
  },
  {
    day: 10,
    id: "checkin_a0_d10",
    type: "checkin",
    state: "checkin_d10",
    cta: {
      action: "choose",
      options: [
        { choice: "pause", label_ar: "استراحة أسبوع" },
        { choice: "shrink", label_ar: "جلسات أقصر" },
        { choice: "switch", label_ar: "مصدر آخر" },
      ],
    },
    text: "عمر، مرّت عشرة أيام منذ آخر اختبار، ولا بأس في ذلك. ما الذي يناسبك الآن: استراحة أسبوع، أم جلسات أقصر، أم مصدر آخر؟",
  },
  { day: 17, id: "weekly_a0_d17", type: "weekly", state: "weekly", cta: REVIEW, text: WEEKLY_TEXT },
  { day: 24, id: "weekly_a0_d24", type: "weekly", state: "weekly", cta: REVIEW, text: WEEKLY_TEXT },
];
const LADDER_IDS = DAY_TABLE.map((row) => row.id);

describe("the coach's ladder on the seed's Omar", () => {
  it.each([0, 1])("sends nothing on day %i, leaving the seed's nudge queued", async (day) => {
    const { sim, phone } = setup();

    const { events } = await sim().set(day);
    await sim().advance({ minutes: 180 });

    expect(events).toEqual([]);
    expect(sim().ladder().state).toBe("active");
    expect(sim().coachEvents()).toEqual([
      expect.objectContaining({ id: "nudge_a0_d2", status: "queued" }),
    ]);
    expect(phone()).toEqual([]);
  });

  it.each(DAY_TABLE)(
    "fires $id on day $day at 09:00 and holds it for quiet hours until 12:00",
    async ({ day, id, type, state, cta, text }) => {
      const { sim, phone } = setup();

      const { events } = await sim().set(day);
      const held = sim().outbox().at(-1);
      const ladder = sim().ladder();
      await sim().advance({ minutes: 180 });

      expect(events.at(-1)).toEqual({
        id,
        sim_day: day,
        type,
        channel: "simulated",
        message_ar: text,
        status: "queued",
      });
      expect(held).toMatchObject({ message: { id, cta }, status: "deferred" });
      expect(held?.deliver_at).toBe(`day ${day} 12:00`);
      expect(ladder.state).toBe(state);
      expect(
        sim()
          .coachEvents()
          .find((e) => e.id === id)?.status,
      ).toBe("sent");
      expect(phone().at(-1)).toMatchObject({ id, direction: "out", text, cta });
      expect(phone().at(-1)?.sim_ts).toBe(`day ${day} 12:00`);
    },
  );

  it("fires the five messages in time order on a jump to day 24, each traced at its own time", async () => {
    const { sim, trace } = setup();

    const { events } = await sim().set(24);

    expect(events.map((e) => e.id)).toEqual(LADDER_IDS);
    expect(
      trace()
        .filter((e) => e.agent === "scheduler")
        .map((e) => [e.sim_ts, e.summary_en, e.summary_ar]),
    ).toEqual([
      [
        "day 2 09:00",
        "nudge_a0_d2: 2 days without a quiz since day 0 -> nudged_d2",
        "مرّ يومان دون دراسة، فاقترح المدرب مهمة من عشر دقائق",
      ],
      [
        "day 5 09:00",
        "replan_a0_d5: 5 days without a quiz since day 0 -> replan_offered_d5",
        "مرّت خمسة أيام دون دراسة، فعرض المدرب أسبوعًا أخف",
      ],
      [
        "day 10 09:00",
        "checkin_a0_d10: 10 days without a quiz since day 0 -> checkin_d10",
        "مرّت عشرة أيام دون دراسة، فسأل المدرب عمّا يناسبه",
      ],
      [
        "day 17 09:00",
        "weekly_a0_d17: 17 days without a quiz since day 0 -> weekly",
        "مرّ أسبوع آخر دون دراسة، فأرسل المدرب رسالته الأسبوعية",
      ],
      [
        "day 24 09:00",
        "weekly_a0_d24: 24 days without a quiz since day 0 -> weekly",
        "مرّ أسبوع آخر دون دراسة، فأرسل المدرب رسالته الأسبوعية",
      ],
    ]);
  });

  it("fires each message on its own day when the clock moves a day at a time", async () => {
    const { sim } = setup();

    const fired: [number, string][] = [];
    for (let day = 1; day <= 24; day++) {
      for (const e of (await sim().advance({ days: 1 })).events) fired.push([day, e.id]);
    }

    expect(fired).toEqual(DAY_TABLE.map((row) => [row.day, row.id]));
  });

  it("names the learner in no trace", async () => {
    const { sim, trace } = setup();

    await sim().set(24);
    await sim().advance({ minutes: 180 });

    const summaries = trace().flatMap((e) => [e.summary_ar, e.summary_en]);
    expect(summaries.filter((s) => s.includes("عمر"))).toEqual([]);
  });
});

describe("opt-out at every step", () => {
  it.each(DAY_TABLE)("sends nothing on day $day after «توقف» the day before", async ({ day }) => {
    const { sim, phone } = setup();
    await sim().set(day - 1);
    sim().reply("توقف");
    const confirmed = phone().length;

    const { events } = await sim().set(day);
    await sim().advance({ minutes: 180 });

    expect(events.at(-1)).toMatchObject({ sim_day: day, status: "suppressed_opt_out" });
    expect(phone().at(confirmed - 1)?.template).toBe("opt_out_confirmation");
    expect(phone().slice(confirmed)).toEqual([]);
    expect(sim().ladder().state).toBe("opted_out");
  });

  it.each(DAY_TABLE)(
    "sends nothing on day $day to an interviewed learner who never agreed",
    async ({ day }) => {
      const { store, sim, phone } = setup();
      store.writeDoc("s_1", "profile", { ...seed.profile, id: "l_new", name: "سارة" });

      const { events } = await sim().set(day);
      await sim().advance({ minutes: 180 });

      expect(events.map((e) => e.sim_day).at(-1)).toBe(day);
      expect(events.every((e) => e.status === "suppressed_opt_out")).toBe(true);
      expect(phone()).toEqual([]);
      expect(sim().ladder().state).toBe("opted_out");
    },
  );
});

describe("activity", () => {
  it("starts the ladder again after a quiz, and traces the reset once", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [0], lesson: null };
    const sim = () => createSim({ store, sessionId: "s_1", seed, coach: { study: () => study } });
    await sim().set(3);
    await sim().advance({ minutes: 60 });
    study.attempt_days.push(3);

    const day4 = await sim().set(4);
    const ladder = sim().ladder();
    const day5 = await sim().set(5);

    expect(day4.events).toEqual([]);
    expect(ladder).toMatchObject({ state: "active", anchor: 3, inactive_days: 1 });
    expect(day5.events.map((e) => e.id)).toEqual(["nudge_a3_d5"]);
    const resets = store.readTrace<TraceEvent>("s_1").filter((e) => e.agent === "coach");
    expect(resets.map((e) => e.sim_ts)).toEqual(["day 3 10:00"]);
    expect(resets[0]?.summary_en).toMatch(/comeback after 3 days/);
  });

  it("gives no lesson button while there is no lesson to open", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [], lesson: null };
    const sim = createSim({ store, sessionId: "s_1", seed, coach: { study: () => study } });

    await sim.set(17);

    expect(sim.outbox().map((e) => [e.message.id, e.message.cta?.action ?? null])).toEqual([
      ["nudge_a0_d2", null],
      ["replan_a0_d5", "open_plan"],
      ["checkin_a0_d10", "choose"],
      ["weekly_a0_d17", null],
    ]);
  });
});

describe("fillTemplate", () => {
  it("fills each variable and refuses one without a value", () => {
    expect(fillTemplate("مرحبًا {name}", { name: "عمر" })).toBe("مرحبًا عمر");
    expect(() => fillTemplate("{name} و{lesson}", { name: "عمر" })).toThrow(/\{lesson\}/);
  });
});
