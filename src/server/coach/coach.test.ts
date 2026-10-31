import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CheckinReply, CoursePlan, QuizAttempt } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed";
import { loadConfig } from "../../config";
import type { SavedPlan } from "../agents/architect/architect";
import { planViolations } from "../agents/architect/rules";
import { createSim } from "../clock/sim";
import { readInbox } from "../notifier/adapters";
import { isStopWord } from "../notifier/notifier";
import { createOrchestrator, StepFailed } from "../orchestrator/orchestrator";
import { loadModels } from "../providers/models";
import { createProvider, type ModelResult, type Provider } from "../providers/provider";
import { contentHash, createFileStore, type Store } from "../store/store";
import type { TraceEvent } from "../trace/trace";
import {
  CHOICE_LABEL,
  CheckinConflict,
  type CoachDeps,
  draftViolations,
  fillTemplate,
  MAX_DRAFT,
  NO_PLAN,
  type Study,
} from "./coach";
import { sessionSim } from "./session";

const TOPIC = "Excel pivot tables for data analysis";
const seed = loadOmarSeed(TOPIC);

// `steps` writes the coach's messages; none sends the templates.
function setup(steps: (store: Store) => CoachDeps["steps"] = () => null) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
  const writer = steps(store);
  // A new sim per call, like one per HTTP request.
  const sim = () => sessionSim(store, "s_1", seed, writer).sim;
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

const lastCoachTrace = (trace: TraceEvent[]) =>
  trace.filter((e) => e.agent === "coach").at(-1)?.summary_en;

describe("opt-out at every step", () => {
  it.each(DAY_TABLE)(
    "sends nothing on day $day after «توقف» the day before, and asks the model nothing",
    async ({ day, id }) => {
      const model = fakeCoachModel(() => "{name}، نص من النموذج.");
      const { sim, phone, trace } = setup(model.steps);
      await sim().set(day - 1);
      sim().reply("توقف");
      const confirmed = phone().length;
      const asked = model.calls.length;

      const { events } = await sim().set(day);
      await sim().advance({ minutes: 180 });

      expect(events.at(-1)).toMatchObject({ sim_day: day, status: "suppressed_opt_out" });
      expect(phone().at(confirmed - 1)?.template).toBe("opt_out_confirmation");
      expect(phone().slice(confirmed)).toEqual([]);
      expect(sim().ladder().state).toBe("opted_out");
      expect(model.calls).toHaveLength(asked);
      expect(lastCoachTrace(trace())).toBe(`${id}: template, no model call: opted out`);
    },
  );

  it.each(DAY_TABLE)(
    "sends nothing on day $day to an interviewed learner who never agreed, and asks the model nothing",
    async ({ day, id }) => {
      const model = fakeCoachModel(() => "{name}، نص من النموذج.");
      const { store, sim, phone, trace } = setup(model.steps);
      store.writeDoc("s_1", "profile", { ...seed.profile, id: "l_new", name: "سارة" });

      const { events } = await sim().set(day);
      await sim().advance({ minutes: 180 });

      expect(events.map((e) => e.sim_day).at(-1)).toBe(day);
      expect(events.every((e) => e.status === "suppressed_opt_out")).toBe(true);
      expect(phone()).toEqual([]);
      expect(sim().ladder().state).toBe("opted_out");
      expect(model.calls).toEqual([]);
      expect(lastCoachTrace(trace())).toBe(`${id}: template, no model call: no consent`);
    },
  );
});

// The coach's model, faked: it answers its nth call with `draft(n)` and keeps each prompt.
function fakeCoachModel(draft: (n: number) => string) {
  const calls: { role: string; prompt: string }[] = [];
  const provider = {
    async structured(call: Parameters<Provider["structured"]>[0]) {
      calls.push({ role: call.role, prompt: `${call.instructions ?? ""}\n${String(call.input)}` });
      return {
        json: { message_ar: draft(calls.length) },
        usage: { in: 0, out: 0, cost_usd: 0 },
      } as unknown as ModelResult<never>;
    },
  } as unknown as Provider;
  return {
    calls,
    steps: (store: Store) => createOrchestrator({ store, makeProvider: () => provider }),
  };
}

describe("the coach's wording", () => {
  it("asks the model with no name, id or topic, and puts the learner's name in itself", async () => {
    const model = fakeCoachModel(() => "{name}، خطوة صغيرة اليوم تكفي.");
    const { sim, phone } = setup(model.steps);

    await sim().set(10);
    await sim().advance({ minutes: 180 });

    expect(model.calls.map((c) => c.role)).toEqual(["coach", "coach", "coach"]);
    const told = [seed.profile.name, seed.profile.id, TOPIC];
    expect(model.calls.flatMap((c) => told.filter((t) => c.prompt.includes(t)))).toEqual([]);
    expect(phone().map((m) => m.text)).toEqual(Array(3).fill("عمر، خطوة صغيرة اليوم تكفي."));
  });

  it("keeps the messages' text out of the trace", async () => {
    const model = fakeCoachModel(() => "{name}، خطوة صغيرة اليوم تكفي.");
    const { sim, trace } = setup(model.steps);

    await sim().set(24);
    await sim().advance({ minutes: 180 });

    const summaries = trace().flatMap((e) => [e.summary_ar, e.summary_en]);
    expect(summaries.filter((s) => s.includes("خطوة صغيرة") || s.includes("عمر"))).toEqual([]);
  });

  it("sends the template, and traces why, when the wording step fails", async () => {
    const runStep = vi.fn(async () => {
      throw new StepFailed("Step coach:nudge_a0_d2 failed: model timed out");
    });
    const { sim, phone, trace } = setup(() => ({ runStep }));

    await sim().set(2);
    await sim().advance({ minutes: 180 });

    expect(phone().at(-1)?.text).toBe(DAY_TABLE[0]?.text);
    expect(
      trace()
        .filter((e) => e.agent === "coach")
        .map((e) => [e.sim_ts, e.kind, e.summary_en]),
    ).toEqual([
      [
        "day 2 09:00",
        "decision",
        expect.stringMatching(/^nudge_a0_d2: .*model timed out.*template/),
      ],
    ]);
  });

  it("asks once more for a draft too long for a gentle message, then sends the template", async () => {
    const model = fakeCoachModel(() => `{name}، ${"ا".repeat(300)}`);
    const { sim, phone, trace } = setup(model.steps);

    await sim().set(2);
    await sim().advance({ minutes: 180 });

    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toMatch(/previous attempt failed: .*308 characters/);
    expect(phone().at(-1)?.text).toBe(DAY_TABLE[0]?.text);
    const summaries = trace().flatMap((e) => [e.summary_ar, e.summary_en]);
    expect(summaries.filter((s) => /nudge_a0_d2: .*sent the template/.test(s))).toHaveLength(1);
    expect(summaries.filter((s) => s.includes("ااا"))).toEqual([]);
  });
});

describe("draftViolations", () => {
  it("passes a short Arabic message that names the learner once", () => {
    expect(draftViolations("{name}، عشر دقائق اليوم تكفي.", "gentle")).toEqual([]);
  });

  it.each([
    ["no Arabic", "Hi {name}, ten minutes today.", /no Arabic/],
    ["no {name}", "عشر دقائق اليوم تكفي.", /\{name\} 0 times/],
    ["{name} twice", "{name}، عشر دقائق تكفي يا {name}.", /\{name\} 2 times/],
    ["another placeholder", "{name}، افتح درس {lesson}.", /braces/],
    ["a link", "{name}، افتح https://example.com الآن.", /web address/],
    ["an email address", "{name}، راسلنا على coach@example.com", /email/],
    ["an emoji", "{name}، عشر دقائق تكفي 💪", /emoji/],
  ])("refuses a message with %s", (_, text, why) => {
    expect(draftViolations(text, "normal")).toEqual([expect.stringMatching(why)]);
  });

  // "{name}، " is 8 characters.
  const ofLength = (n: number) => `{name}، ${"ا".repeat(n - 8)}`;

  it("holds a gentle message to 160 characters and a normal one to 260", () => {
    expect(draftViolations(ofLength(160), "gentle")).toEqual([]);
    expect(draftViolations(ofLength(161), "gentle")).toEqual([
      "the message has 161 characters; at most 160",
    ]);
    expect(draftViolations(ofLength(260), "normal")).toEqual([]);
    expect(draftViolations(ofLength(261), "normal")).toEqual([
      "the message has 261 characters; at most 260",
    ]);
  });
});

describe("activity", () => {
  it("starts the ladder again after a quiz, and traces the reset once", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [0], lesson: null };
    const sim = () =>
      createSim({
        store,
        sessionId: "s_1",
        seed,
        coach: { steps: null, study: () => study, replan: async () => NO_PLAN },
      });
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

  it("ends a pause when the learner takes a quiz", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [0], lesson: null };
    const sim = () =>
      createSim({
        store,
        sessionId: "s_1",
        seed,
        coach: { steps: null, study: () => study, replan: async () => NO_PLAN },
      });
    await sim().set(10);
    await sim().advance({ minutes: 180 });
    await sim().answer(reply("pause", 10));
    await sim().set(12);
    study.attempt_days.push(12);

    const day14 = await sim().set(14);

    expect(day14.events.map((e) => e.id)).toEqual(["nudge_a12_d14"]);
    expect(sim().ladder()).toMatchObject({ state: "nudged_d2", paused_until: null });
  });

  it("gives no lesson button while there is no lesson to open", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [], lesson: null };
    const sim = createSim({
      store,
      sessionId: "s_1",
      seed,
      coach: { steps: null, study: () => study, replan: async () => NO_PLAN },
    });

    await sim.set(17);

    expect(sim.outbox().map((e) => [e.message.id, e.message.cta?.action ?? null])).toEqual([
      ["nudge_a0_d2", null],
      ["replan_a0_d5", "open_plan"],
      ["checkin_a0_d10", "choose"],
      ["weekly_a0_d17", null],
    ]);
  });
});

const CHECKIN = "checkin_a0_d10";
const reply = (choice: CheckinReply["choice"], pause_days = 7): CheckinReply => ({
  event_id: CHECKIN,
  choice,
  pause_days,
});
const OPEN_PLAN = { label_ar: "افتح خطتي", action: "open_plan" };

// The check-in reaches the seed's Omar at 12:00 on day 10, when his quiet hours end.
async function checkedIn() {
  const t = setup();
  await t.sim().set(10);
  await t.sim().advance({ minutes: 180 });
  return t;
}

// A learner the interview saved, with consent and no quiet hours, on the seed's plan as their own,
// who passed L1 on day 0: L1's sessions stay 45 minutes, and L2's are the ones to shrink.
const sara = { ...seed.profile, id: "l_sara", name: "سارة" };
const PLAN = seed.plans[0] as CoursePlan;
function giveOwnPlan(store: Store) {
  store.writeDoc("s_1", "profile", sara);
  store.writeDoc("s_1", "plan", {
    for_profile: contentHash(sara),
    versions: [PLAN],
    resources: seed.resources,
    limits: { budget_minutes: 300, resource_ids: seed.resources.map((r) => r.id) },
  } satisfies SavedPlan);
  const passedL1: QuizAttempt = { ...(seed.attempts[0] as QuizAttempt), score: 1, passed: true };
  store.writeDoc("s_1", "quizzes", {
    for_plan: PLAN.id,
    quizzes: seed.quizzes,
    attempts: [passedL1],
    mastery: [{ lesson_id: "L1", best_score: 1, passed: true, attempts: 1 }],
  });
}
async function checkedInWithOwnPlan() {
  const t = setup();
  giveOwnPlan(t.store);
  t.sim().setConsent({ messages: true, quiet_hours: null, intensity: "gentle" });
  await t.sim().set(10);
  return t;
}
const savedVersions = (store: Store) => store.readDoc<SavedPlan>("s_1", "plan")?.versions ?? [];

describe("answers to the day-10 check-in", () => {
  it("pauses the coach's messages for the days chosen, then the weekly ones go on", async () => {
    const { sim, phone } = await checkedIn();

    const answer = await sim().answer(reply("pause", 10));
    const paused = sim().ladder();
    const day17 = await sim().set(17);
    const day20 = await sim().set(20);
    const state20 = sim().ladder().state;
    const day24 = await sim().set(24);

    expect(answer).toEqual({ choice: "pause", paused_until: "day 20 09:00", plan_version: null });
    expect(phone().slice(-2)).toMatchObject([
      { direction: "in", text: "استراحة أسبوع", sim_ts: "day 10 12:00" },
      {
        id: `ack_${CHECKIN}`,
        direction: "out",
        text: "حسنًا، لا رسائل مني حتى اليوم ٢٠. خطتك ومكانك محفوظان.",
        cta: null,
        sim_ts: "day 10 12:00",
      },
    ]);
    expect(paused).toMatchObject({ state: "paused", paused_until: { day: 20, minute: 540 } });
    expect(day17.events).toEqual([]);
    expect(day20.events).toEqual([]);
    expect(state20).toBe("weekly");
    expect(day24.events.map((e) => e.id)).toEqual(["weekly_a0_d24"]);
  });

  it("lets the weekly message on day 17 through after a pause of a week", async () => {
    const { sim, phone } = await checkedIn();

    await sim().answer(reply("pause", 7));
    const day17 = await sim().set(17);

    expect(phone().at(-1)?.text).toBe("حسنًا، لا رسائل مني حتى اليوم ١٧. خطتك ومكانك محفوظان.");
    expect(day17.events.map((e) => e.id)).toEqual(["weekly_a0_d17"]);
  });

  it("holds the acknowledgement of a reply at 23:00 until his quiet hours end", async () => {
    const { sim, phone } = await checkedIn();
    await sim().advance({ minutes: 11 * 60 });

    await sim().answer(reply("pause"));
    const held = sim().outbox().at(-1);
    const before = phone().at(-1);
    await sim().advance({ minutes: 13 * 60 });

    expect(held).toMatchObject({
      message: { id: `ack_${CHECKIN}` },
      status: "deferred",
      deliver_at: "day 11 12:00",
    });
    expect(before).toMatchObject({ direction: "in", sim_ts: "day 10 23:00" });
    expect(phone().at(-1)).toMatchObject({ id: `ack_${CHECKIN}`, sim_ts: "day 11 12:00" });
  });

  it("shrinks the sessions of the lessons the learner has not passed, as the plan's next version", async () => {
    const { store, sim, phone } = await checkedInWithOwnPlan();

    const answer = await sim().answer(reply("shrink"));
    const answered = phone().slice(-2);
    const state = sim().ladder().state;
    const day17 = await sim().set(17);

    const [before, after] = savedVersions(store);
    expect(answer).toEqual({ choice: "shrink", paused_until: null, plan_version: 2 });
    expect(after).toMatchObject({ id: PLAN.id, version: 2, reason: "shrink" });
    expect(after?.committed.sessions.map((s) => [s.lesson_id, s.minutes])).toEqual([
      ["L1", 45],
      ["L1", 45],
      ["L2", 25],
      ["L2", 25],
    ]);
    expect(before).toEqual(PLAN);
    const limits = store.readDoc<SavedPlan>("s_1", "plan")?.limits;
    expect(after && limits && planViolations(after, limits)).toEqual([]);
    expect(answered).toMatchObject([
      { direction: "in", text: "جلسات أقصر" },
      {
        id: `ack_${CHECKIN}`,
        text: "خفّفنا خطتك: جلسات أقصر والهدف نفسه. تجد النسخة الجديدة في خطتك.",
        cta: OPEN_PLAN,
      },
    ]);
    expect(state).toBe("checkin_d10");
    expect(day17.events.map((e) => e.id)).toEqual(["weekly_a0_d17"]);
  });

  it("tells the seed's Omar, who has no plan of his own, that it shrinks his sessions once he has one", async () => {
    const { store, sim, phone } = await checkedIn();

    const answer = await sim().answer(reply("shrink"));

    expect(answer).toEqual({ choice: "shrink", paused_until: null, plan_version: null });
    expect(store.readDoc("s_1", "plan")).toBeUndefined();
    expect(phone().at(-1)).toMatchObject({
      id: `ack_${CHECKIN}`,
      text: "سنجعل جلساتك أقصر حين تجهز خطتك.",
      cta: null,
    });
  });

  it("records a switch for the re-planner and leaves the plan as it is", async () => {
    const { store, sim, phone, trace } = await checkedInWithOwnPlan();

    const answer = await sim().answer(reply("switch"));

    expect(answer).toEqual({ choice: "switch", paused_until: null, plan_version: null });
    expect(savedVersions(store)).toEqual([PLAN]);
    expect(sim().checkinReplies()).toEqual([
      { ...reply("switch"), sim_ts: "day 10 09:00", anchor: 0, plan_version: null },
    ]);
    expect(phone().at(-1)).toMatchObject({
      text: "سنقترح عليك مصدرًا آخر للدرس نفسه.",
      cta: OPEN_PLAN,
    });
    expect(
      trace()
        .filter((e) => e.agent === "coach")
        .map((e) => e.summary_en),
    ).toEqual([
      expect.stringMatching(
        /l_sara.*switch recorded; the re-planner \(#26\) picks another resource/,
      ),
    ]);
  });

  it("traces each answer by the learner's id, with no message text", async () => {
    const { sim, trace } = await checkedIn();

    await sim().answer(reply("pause"));

    const answered = trace().filter((e) => e.agent === "coach");
    expect(answered.map((e) => [e.sim_ts, e.summary_en])).toEqual([
      [
        "day 10 12:00",
        `${CHECKIN} answered by l_omar: pause; no coach messages until day 17 09:00`,
      ],
    ]);
    const texts = ["عمر", ...Object.values(CHOICE_LABEL), "خطتك"];
    const summaries = trace().flatMap((e) => [e.summary_ar, e.summary_en]);
    expect(summaries.filter((s) => texts.some((t) => s.includes(t)))).toEqual([]);
  });

  it("takes no button label for a stop word", () => {
    expect(Object.values(CHOICE_LABEL).filter(isStopWord)).toEqual([]);
  });

  it.each([
    ["an event the learner never got", async () => ({ ...reply("pause"), event_id: "nope" })],
    [
      "a check-in still held for quiet hours",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(10);
        return reply("pause");
      },
    ],
    [
      "a choice the message does not offer",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(2);
        await t.sim().advance({ minutes: 180 });
        return { ...reply("shrink"), event_id: "nudge_a0_d2" };
      },
    ],
    [
      "a check-in answered already",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(10);
        await t.sim().advance({ minutes: 180 });
        await t.sim().answer(reply("switch"));
        return reply("pause");
      },
    ],
    [
      "a learner who stopped the messages",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(10);
        await t.sim().advance({ minutes: 180 });
        t.sim().reply("توقف");
        return reply("pause");
      },
    ],
  ])("refuses an answer to %s, and changes nothing", async (_, prepare) => {
    const t = setup();
    const answer = await prepare(t);
    const before = { phone: t.phone(), replies: t.sim().checkinReplies(), trace: t.trace() };

    await expect(t.sim().answer(answer)).rejects.toBeInstanceOf(CheckinConflict);

    expect({ phone: t.phone(), replies: t.sim().checkinReplies(), trace: t.trace() }).toEqual(
      before,
    );
  });
});

describe("fillTemplate", () => {
  it("fills each variable and refuses one without a value", () => {
    expect(fillTemplate("مرحبًا {name}", { name: "عمر" })).toBe("مرحبًا عمر");
    expect(() => fillTemplate("{name} و{lesson}", { name: "عمر" })).toThrow(/\{lesson\}/);
  });
});

// RECORD_FIXTURES is a test-only switch, as in contracts/smoke.test.ts: re-record with
// `pnpm fixtures:record`.
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");
const recordedWriter = (store: Store) =>
  createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({
        models: loadModels(),
        profile: recording ? "record" : "replay",
        apiKey: recording ? loadConfig(process.env).modelApiKey : undefined,
        onTrace,
      }),
  });

describe("the coach's ladder in Spark's words, replaying the recorded messages", () => {
  it.each(["gentle", "normal"] as const)(
    "writes the seed's Omar each message to day 24 in the %s tone",
    async (intensity) => {
      const { sim, trace } = setup(recordedWriter);
      sim().setConsent({ messages: true, quiet_hours: seed.consent.quiet_hours, intensity });

      const { events } = await sim().set(24);

      expect(events.map((e) => e.id)).toEqual(LADDER_IDS);
      for (const { message_ar } of events) {
        expect(message_ar.length).toBeLessThanOrEqual(MAX_DRAFT[intensity]);
        expect(message_ar.split("عمر")).toHaveLength(2);
        expect(message_ar).not.toMatch(/[{}]/);
      }
      const coach = trace().filter((e) => e.agent === "coach");
      expect(coach.filter((e) => e.kind === "model_call").length).toBeGreaterThanOrEqual(5);
      expect(coach.filter((e) => /template/.test(e.summary_en))).toEqual([]);
    },
    300_000,
  );
});
