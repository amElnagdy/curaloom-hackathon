import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckinReply, CoursePlan, Quiz } from "../../../contracts/index.ts";
import { RECORDED_TOPIC } from "../../../demo/script.ts";
import { loadOmarSeed } from "../../../demo/seed";
import { loadConfig } from "../../config";
import { type Replanned, type SavedPlan, savedPlan } from "../agents/architect/architect";
import type { ReplanRequest } from "../agents/architect/replan";
import { AttemptInvalid } from "../agents/examiner/examiner";
import { attemptOf, masteryAfter, recapQuiz } from "../agents/examiner/rules";
import { createSim } from "../clock/sim";
import { readInbox } from "../notifier/adapters";
import { isStopWord } from "../notifier/notifier";
import { createOrchestrator, StepFailed } from "../orchestrator/orchestrator";
import { loadModels } from "../providers/models";
import {
  createProvider,
  type ModelResult,
  type Provider,
  type StructuredCall,
} from "../providers/provider";
import { contentHash, createFileStore, type Store } from "../store/store";
import { arabicLineProblems } from "../trace/arabic-line";
import type { TraceEvent } from "../trace/trace";
import {
  CHOICE_LABEL,
  CheckinConflict,
  type CoachDeps,
  ComebackConflict,
  draftViolations,
  fillTemplate,
  MAX_DRAFT,
  type Study,
} from "./coach";
import { sessionSim } from "./session";

const seed = loadOmarSeed(RECORDED_TOPIC);

// Every Arabic trace line a test's setup traced reads as Arabic (#59), the templates' included.
const traced: (() => TraceEvent[])[] = [];
afterEach(() => {
  for (const trace of traced.splice(0)) {
    for (const e of trace()) expect(arabicLineProblems(e.summary_ar), e.summary_ar).toEqual([]);
  }
});

// `steps` writes the coach's messages; none sends the templates.
function setup(steps: (store: Store) => CoachDeps["steps"] = () => null) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
  const writer = steps(store);
  // A new sim per call, like one per HTTP request.
  const sim = () => sessionSim(store, "s_1", seed, writer).sim;
  const phone = () => readInbox(store, "s_1");
  const trace = () => store.readTrace<TraceEvent>("s_1");
  traced.push(trace);
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
    "fires $id on a jump to day $day at 12:00, after his quiet hours",
    async ({ day, id, type, state, cta, text }) => {
      const { sim, phone } = setup();

      const { now, events } = await sim().set(day);
      const ladder = sim().ladder();

      expect(now).toBe(`day ${day} 12:00`);
      expect(events.at(-1)).toEqual({
        id,
        sim_day: day,
        type,
        channel: "simulated",
        message_ar: text,
        status: "sent",
      });
      expect(ladder.state).toBe(state);
      expect(phone().at(-1)).toMatchObject({
        id,
        direction: "out",
        text,
        cta,
        sim_ts: `day ${day} 12:00`,
      });
    },
  );

  it("holds a 09:00 rung for quiet hours until 12:00 when the clock advances into the morning", async () => {
    const { sim, phone } = setup();

    const { now, events } = await sim().advance({ days: 2 });
    const held = sim().outbox().at(-1);
    await sim().advance({ minutes: 180 });

    expect(now).toBe("day 2 09:00");
    expect(events.at(-1)).toMatchObject({ id: "nudge_a0_d2", status: "queued" });
    expect(held).toMatchObject({
      message: { id: "nudge_a0_d2" },
      status: "deferred",
      deliver_at: "day 2 12:00",
    });
    expect(phone().at(-1)).toMatchObject({ id: "nudge_a0_d2", sim_ts: "day 2 12:00" });
  });

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
        "مرّت عشرة أيام دون دراسة، فسأل المدرب عمّا يناسبك",
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
    const told = [seed.profile.name, seed.profile.id, RECORDED_TOPIC];
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

// The coach of a learner with no plan of their own, studying as `study` says.
const noPlan = (study: Study): CoachDeps => ({
  steps: null,
  study: () => study,
  replan: async () => {
    throw new Error("a learner with no plan of their own has nothing to re-plan");
  },
  recap: () => undefined,
});

describe("activity", () => {
  it("starts the ladder again after a quiz, and traces the reset once", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [0], lesson: null, own_plan: false };
    const sim = () =>
      createSim({
        store,
        sessionId: "s_1",
        seed,
        coach: noPlan(study),
      });
    await sim().advance({ days: 3, minutes: 60 });
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
    expect(resets[0]?.summary_ar).toBe(
      "أجبتَ عن اختبار في اليوم ٣ بعد غياب، فبدأ المدرب العدّ من جديد",
    );
  });

  it("ends a pause when the learner takes a quiz", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
    const study: Study = { attempt_days: [0], lesson: null, own_plan: false };
    const sim = () =>
      createSim({
        store,
        sessionId: "s_1",
        seed,
        coach: noPlan(study),
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
    const study: Study = { attempt_days: [], lesson: null, own_plan: false };
    const sim = createSim({
      store,
      sessionId: "s_1",
      seed,
      coach: noPlan(study),
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
// The check-in reaches the seed's Omar at 12:00 on day 10, when his quiet hours end.
async function checkedIn() {
  const t = setup();
  await t.sim().set(10);
  return t;
}

// L1's quiz, five multiple-choice items, which the learner passed on day 0, and the recap of five
// items it gives once they come back.
const QUIZ_L1: Quiz = {
  id: "q_L1_a",
  lesson_id: "L1",
  items: ["i1", "i2", "i3", "i4", "i5"].map((id) => ({
    id,
    type: "mcq",
    prompt_ar: `سؤال ${id}`,
    options_ar: ["صحيح", "خطأ أ", "خطأ ب"],
    answer: "صحيح",
    rubric_ar: "لأنه الصحيح.",
    glossary_ids: [],
  })),
  pass_threshold: 0.8,
};
const PASSED_L1 = attemptOf(
  QUIZ_L1,
  QUIZ_L1.items.map((i) => ({ item_id: i.id, response: "صحيح", score: 1, feedback_ar: "صحيح." })),
  0,
);
const RECAP = recapQuiz([QUIZ_L1], [PASSED_L1], [masteryAfter(undefined, PASSED_L1)]) as Quiz;
// Answers to the recap with the first `right` of them right.
const recapAnswers = (right: number) => ({
  quiz_id: RECAP.id,
  answers: RECAP.items.map((item, i) => ({
    item_id: item.id,
    response: i < right ? item.answer : "خطأ أ",
  })),
});

// A learner the interview saved, with consent and no quiet hours, on the seed's plan as their own,
// who passed L1 on day 0.
const sara = { ...seed.profile, id: "l_sara", name: "سارة" };
const PLAN = seed.plans[0] as CoursePlan;
function giveOwnPlan(store: Store) {
  store.writeDoc("s_1", "profile", sara);
  store.writeDoc("s_1", "plan", {
    for_profile: contentHash(sara),
    versions: [PLAN],
    resources: seed.resources,
    limits: { budget_minutes: 300, resource_ids: seed.resources.map((r) => r.id) },
    pending: null,
  } satisfies SavedPlan);
  store.writeDoc("s_1", "quizzes", {
    for_plan: PLAN.id,
    quizzes: [QUIZ_L1],
    attempts: [PASSED_L1],
    mastery: [masteryAfter(undefined, PASSED_L1)],
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
    const pausedPhone = phone().slice(-2);
    const day17 = await sim().set(17);
    const day20 = await sim().set(20);
    const state20 = sim().ladder().state;
    const day24 = await sim().set(24);

    expect(answer).toEqual({ choice: "pause", paused_until: "day 20 09:00" });
    expect(pausedPhone).toMatchObject([
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

    expect(day17.events.map((e) => e.id)).toEqual(["weekly_a0_d17"]);
    expect(phone().at(-1)?.text).toBe(WEEKLY_TEXT);
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

  // The re-plan comes when the learner finishes their comeback (#27), so an answer saves no plan
  // version: it sees them back and sends them to their plan for the recap.
  it.each([
    [
      "shrink",
      "اتفقنا: جلسات أقصر. افتح خطتك لمراجعة من خمسة أسئلة في نحو خمس دقائق، ثم نعرض عليك خطتك الجديدة لتوافق عليها.",
    ],
    [
      "switch",
      "اتفقنا: مصدر آخر. افتح خطتك لمراجعة قصيرة، ثم نقترح عليك مصدرًا بديلًا مما وجده الكشّاف.",
    ],
  ] as const)(
    "records a %s, sees the learner back and sends them to their plan, which stays as it is",
    async (choice, ack) => {
      const { store, sim, phone, trace } = await checkedInWithOwnPlan();

      const answer = await sim().answer(reply(choice));
      const answered = phone().slice(-2);
      const state = sim().ladder().state;
      const day17 = await sim().set(17);

      expect(answer).toEqual({ choice, paused_until: null });
      expect(savedVersions(store)).toEqual([PLAN]);
      expect(savedPlan(store, "s_1")?.pending).toBeNull();
      expect(sim().checkinReplies()).toEqual([
        { ...reply(choice), sim_ts: "day 10 09:00", anchor: 0 },
      ]);
      expect(sim().comeback()).toMatchObject({ state: "open", away_days: 10, reason: choice });
      expect(answered).toMatchObject([
        { direction: "in", text: CHOICE_LABEL[choice] },
        { id: `ack_${CHECKIN}`, text: ack, cta: { label_ar: "افتح خطتي", action: "open_plan" } },
      ]);
      expect(
        trace()
          .filter((e) => e.agent === "coach")
          .map((e) => e.summary_en),
      ).toEqual([
        `${CHECKIN} answered by l_sara: ${choice} recorded`,
        "comeback_detected: l_sara back after 10 days (via reply)",
      ]);
      expect(state).toBe("checkin_d10");
      expect(day17.events.map((e) => e.id)).toEqual(["weekly_a0_d17"]);
    },
  );

  it("records a shrink from the seed's Omar, who has no plan of his own, and sees no comeback", async () => {
    const { store, sim, phone, trace } = await checkedIn();

    const answer = await sim().answer(reply("shrink"));

    expect(answer).toEqual({ choice: "shrink", paused_until: null });
    expect(store.readDoc("s_1", "plan")).toBeUndefined();
    expect(phone().at(-1)).toMatchObject({
      id: `ack_${CHECKIN}`,
      text: "حسنًا، سجّلتُ أنك تريد جلسات أقصر.",
      cta: null,
    });
    expect(sim().comeback()).toEqual({ state: "none", last: null });
    expect(trace().filter((e) => e.summary_en.startsWith("comeback_detected"))).toEqual([]);
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
        await t.sim().advance({ days: 10 });
        return reply("pause");
      },
    ],
    [
      "a choice the message does not offer",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(2);
        return { ...reply("shrink"), event_id: "nudge_a0_d2" };
      },
    ],
    [
      "a check-in answered already",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(10);
        await t.sim().answer(reply("switch"));
        return reply("pause");
      },
    ],
    [
      "a learner who stopped the messages",
      async (t: ReturnType<typeof setup>) => {
        await t.sim().set(10);
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

const V2: Replanned = { ok: true, version: 2, lighter: { minutes: 55, cap: 84 } };

// A learner on a plan of their own, with messages on and no quiet hours, who passed L1 on day 0
// and studied no more. The re-planner is faked: it keeps each request and proposes v2. `recorded`
// is the replayed run's, `steps` writes the messages.
function returning({
  recap = true,
  recorded,
  steps = () => null,
}: {
  recap?: boolean;
  recorded?: CoachDeps["recorded"];
  steps?: (store: Store) => CoachDeps["steps"];
} = {}) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "coach-")));
  const requests: ReplanRequest[] = [];
  const study: Study = {
    attempt_days: [0],
    lesson: { id: "L2", title_ar: "الدرس الثاني", best_percent: null },
    own_plan: true,
  };
  const writer = steps(store);
  const sim = () =>
    createSim({
      store,
      sessionId: "s_1",
      seed,
      coach: {
        steps: writer,
        study: () => study,
        replan: async (request) => {
          requests.push(request);
          return V2;
        },
        recap: () => (recap ? { quiz: RECAP, quizzes: [QUIZ_L1] } : undefined),
        recorded,
      },
    });
  sim().setConsent({ messages: true, quiet_hours: null, intensity: "gentle" });
  const trace = () => store.readTrace<TraceEvent>("s_1");
  const coachSaid = () =>
    trace()
      .filter((e) => e.agent === "coach")
      .map((e) => e.summary_en);
  return { sim, study, requests, phone: () => readInbox(store, "s_1"), trace, coachSaid };
}

describe("a learner's comeback (#27)", () => {
  it.each([
    [0, "none"],
    [1, "none"],
    [2, "due"],
    [5, "due"],
    [10, "due"],
  ])("is %s days away: %s", async (day, state) => {
    const { sim } = returning();

    await sim().set(day);

    expect(sim().comeback().state).toBe(state);
  });

  it("opens when the plan page sees them back, with the recap to take and no keys", async () => {
    const { sim, coachSaid } = returning();
    await sim().set(10);

    const opened = sim().detectComeback();

    expect(opened).toMatchObject({ state: "open", away_days: 10, reason: "inactivity_d5" });
    expect(opened.state !== "none" && opened.recap?.items.map((i) => i.id)).toEqual(
      RECAP.items.map((i) => i.id),
    );
    expect(JSON.stringify(opened)).not.toContain('"answer"');
    expect(coachSaid()).toEqual(["comeback_detected: l_omar back after 10 days (via open)"]);
  });

  it("sees them back on a reply in their own words, but not on a pause or «توقف»", async () => {
    const paused = returning();
    const stopped = returning();
    const wrote = returning();
    for (const t of [paused, stopped, wrote]) await t.sim().set(10);

    await paused.sim().answer(reply("pause"));
    stopped.sim().reply("توقف");
    wrote.sim().reply("رجعت، آسف على الغياب");

    expect(paused.sim().comeback().state).toBe("due");
    expect(stopped.sim().comeback().state).toBe("due");
    expect(wrote.sim().comeback()).toMatchObject({ state: "open", away_days: 10 });
    expect(wrote.coachSaid()).toEqual(["comeback_detected: l_omar back after 10 days (via reply)"]);
  });

  it("sees a return once per ladder, however often they come back to it", async () => {
    const { sim, coachSaid } = returning();
    await sim().set(10);

    await sim().answer(reply("shrink"));
    sim().reply("وصلت");
    sim().detectComeback();
    await sim().advance({ days: 1 });
    sim().detectComeback();

    expect(coachSaid().filter((s) => s.startsWith("comeback_detected"))).toEqual([
      "comeback_detected: l_omar back after 10 days (via reply)",
    ]);
    expect(sim().comeback()).toMatchObject({ state: "open", away_days: 10 });
  });

  it("grades the recap in code and asks for the re-plan their return calls for", async () => {
    const { sim, requests } = returning();
    await sim().set(10);
    await sim().answer(reply("shrink"));

    const finished = await sim().finishComeback(recapAnswers(3));

    expect(requests).toEqual([
      {
        reason: "shrink",
        today: 10,
        away_days: 10,
        recap: { below_gate: true, review_lesson: "L1" },
      },
    ]);
    expect(finished.replanned).toEqual(V2);
    expect(finished.comeback).toMatchObject({
      state: "none",
      last: {
        anchor: 0,
        via: "reply",
        away_days: 10,
        plan_version: 2,
        done_at: "day 10 09:00",
        recap: { below_gate: true, review_lesson: "L1", attempt: { score: 0.6, passed: false } },
      },
    });
  });

  it("asks for no review after a recap at the gate", async () => {
    const { sim, requests } = returning();
    await sim().set(10);

    await sim().finishComeback(recapAnswers(4));

    expect(requests.map((r) => r.recap)).toEqual([{ below_gate: false, review_lesson: null }]);
  });

  it("starts the ladder again from the day they finish, quietly, with the next nudge two days on", async () => {
    const { sim, coachSaid } = returning();
    await sim().set(10);
    await sim().finishComeback(recapAnswers(3));
    const said = coachSaid().length;

    const ladder = sim().ladder();
    const after = sim().comeback().state;
    const day11 = await sim().set(11);
    const day12 = await sim().set(12);

    expect(ladder).toMatchObject({ state: "active", anchor: 10, next: { id: "nudge_a10_d12" } });
    expect(day11.events).toEqual([]);
    expect(day12.events.map((e) => e.id)).toEqual(["nudge_a10_d12"]);
    expect(after).toBe("none");
    expect(coachSaid().slice(said)).toEqual([]);
  });

  it.each([
    ["the learner asked for nothing, after the day-5 offer", "inactivity_d5", () => {}],
    [
      "the day-5 offer never reached them",
      "comeback",
      (t: ReturnType<typeof returning>) =>
        t.sim().setConsent({ messages: false, quiet_hours: null, intensity: "gentle" }),
    ],
  ] as const)("re-plans for the return when %s", async (_, reason, prepare) => {
    const t = returning();
    prepare(t);
    await t.sim().set(10);

    await t.sim().finishComeback(recapAnswers(5));

    expect(t.requests.map((r) => r.reason)).toEqual([reason]);
  });

  it("re-plans without a recap while no lesson is passed, and refuses that once one is", async () => {
    const none = returning({ recap: false });
    const some = returning();
    await none.sim().set(10);
    await some.sim().set(10);

    await none.sim().finishComeback(null);

    expect(none.requests.map((r) => r.recap)).toEqual([null]);
    await expect(some.sim().finishComeback(null)).rejects.toBeInstanceOf(ComebackConflict);
    await expect(none.sim().finishComeback(recapAnswers(5))).rejects.toBeInstanceOf(
      ComebackConflict,
    );
  });

  it("refuses a second finish, a recap that is not the one to take, and blank answers", async () => {
    const { sim, requests } = returning();
    await sim().set(10);
    const blank = recapAnswers(5);
    blank.answers[0] = { item_id: RECAP.items[0]?.id ?? "", response: " " };

    await expect(
      sim().finishComeback({ ...recapAnswers(5), quiz_id: "recap_old" }),
    ).rejects.toBeInstanceOf(ComebackConflict);
    await expect(sim().finishComeback(blank)).rejects.toBeInstanceOf(AttemptInvalid);
    await sim().finishComeback(recapAnswers(5));
    await expect(sim().finishComeback(recapAnswers(5))).rejects.toBeInstanceOf(ComebackConflict);

    expect(requests).toHaveLength(1);
  });

  it("refuses an answer to the check-in of a ladder that ended", async () => {
    const finished = returning();
    const quizzed = returning();
    for (const t of [finished, quizzed]) await t.sim().set(10);
    await finished.sim().finishComeback(recapAnswers(5));
    quizzed.study.attempt_days.push(10);

    await expect(finished.sim().answer(reply("pause"))).rejects.toBeInstanceOf(CheckinConflict);
    await expect(quizzed.sim().answer(reply("shrink"))).rejects.toBeInstanceOf(CheckinConflict);
    expect(quizzed.sim().checkinReplies()).toEqual([]);
  });

  it("traces the return in order, naming the learner by id only", async () => {
    const { sim, trace, coachSaid } = returning();
    await sim().set(10);
    await sim().answer(reply("shrink"));

    await sim().finishComeback(recapAnswers(3));

    expect(coachSaid()).toEqual([
      `${CHECKIN} answered by l_omar: shrink recorded`,
      "comeback_detected: l_omar back after 10 days (via reply)",
      "recap_quiz: graded by code 3/5 (60%), below the 80% gate -> review L1",
      "active: ladder reset on day 10",
    ]);
    const summaries = trace().flatMap((e) => [e.summary_ar, e.summary_en]);
    expect(summaries.filter((s) => s.includes("عمر"))).toEqual([]);
  });

  it("proposes the learner's v2 through their saved plan when they finish on their own plan", async () => {
    const { store, sim } = await checkedInWithOwnPlan();
    await sim().answer(reply("shrink"));

    const { replanned } = await sim().finishComeback(recapAnswers(3));

    expect(replanned).toMatchObject({ ok: true, version: 2 });
    expect(savedVersions(store)).toEqual([PLAN]);
    const pending = savedPlan(store, "s_1")?.pending;
    expect(pending).toMatchObject({ version: 2, reason: "shrink", committed: { start: "day10" } });
    expect(pending?.diff[0]).toMatchObject({ op: "review", lesson: "L1", day: 10, minutes: 15 });
  });
});

// The replayed run (#55): one comeback on day 10, from «جلسات أقصر» or «مصدر آخر» at the check-in of
// the ladder from day 0, with three of five recap items right before «مصدر آخر», and gentle messages
// whose wording is recorded.
const RECORDED = { anchor: 0, day: 10, switch_recap_right: 3, worded: () => true };

describe("a comeback in replay, which keeps to the recorded one (#55)", () => {
  it("holds the return back until «جلسات أقصر» or «مصدر آخر» at the check-in, and for good after «استراحة أسبوع»", async () => {
    const early = returning({ recorded: RECORDED });
    const paused = returning({ recorded: RECORDED });
    const asked = returning({ recorded: RECORDED });
    await early.sim().set(5);
    for (const t of [paused, asked]) await t.sim().set(10);

    early.sim().reply("رجعت");
    await paused.sim().answer(reply("pause"));
    await asked.sim().answer(reply("switch"));
    await paused.sim().set(17);

    for (const [t, held] of [
      [early, "checkin"],
      [paused, "paused"],
    ] as const) {
      expect(t.sim().detectComeback()).toEqual({ state: "none", last: null, held });
      expect(t.coachSaid().filter((s) => s.startsWith("comeback_detected"))).toEqual([]);
      await expect(t.sim().finishComeback(recapAnswers(3))).rejects.toThrow(ComebackConflict);
    }
    expect(asked.sim().comeback()).toMatchObject({ state: "open", away_days: 10 });
  });

  it("holds a return finished after the recorded day, and one with no lesson passed", async () => {
    const late = returning({ recorded: RECORDED });
    const unpassed = returning({ recorded: RECORDED, recap: false });
    for (const t of [late, unpassed]) {
      await t.sim().set(10);
      await t.sim().answer(reply("shrink"));
    }

    await late.sim().set(11);

    for (const t of [late, unpassed]) {
      expect(t.sim().detectComeback()).toMatchObject({ state: "none", held: "once" });
      await expect(t.sim().finishComeback(null)).rejects.toThrow(ComebackConflict);
      expect(t.requests).toEqual([]);
    }
  });

  it("holds a second return back, and one from a ladder the run did not start", async () => {
    const again = returning({ recorded: RECORDED });
    const later = returning({ recorded: { ...RECORDED, anchor: 3 } });
    for (const t of [again, later]) await t.sim().set(10);
    await again.sim().answer(reply("shrink"));
    await again.sim().finishComeback(recapAnswers(3));

    await again.sim().set(14);
    await later.sim().answer(reply("shrink"));

    expect(again.sim().comeback()).toMatchObject({ state: "none", held: "once" });
    expect(later.sim().comeback()).toMatchObject({ state: "none", held: "once" });
  });

  it("grades the recorded recap in place of one at the gate before «مصدر آخر»", async () => {
    const switched = returning({ recorded: RECORDED });
    const shrunk = returning({ recorded: RECORDED });
    for (const t of [switched, shrunk]) await t.sim().set(10);
    await switched.sim().answer(reply("switch"));
    await shrunk.sim().answer(reply("shrink"));

    const { comeback } = await switched.sim().finishComeback(recapAnswers(5));
    await shrunk.sim().finishComeback(recapAnswers(5));

    expect(switched.requests.map((r) => r.recap)).toEqual([
      { below_gate: true, review_lesson: "L1" },
    ]);
    expect(comeback.last?.recap).toMatchObject({
      replaced: true,
      attempt: { score: 0.6, passed: false },
    });
    expect(switched.coachSaid()).toContain(
      "Replay: graded the recorded recap (3 right) in place of the learner's, the only one the recorded switch re-plan follows",
    );
    expect(shrunk.requests.map((r) => r.recap)).toEqual([
      { below_gate: false, review_lesson: null },
    ]);
  });

  it("sends a message whose wording has no recording as its template, and asks the model only for the recorded ones", async () => {
    const model = fakeCoachModel(() => "{name}، خطوة صغيرة اليوم تكفي.");
    const asked: string[] = [];
    const worded = (call: StructuredCall) => {
      asked.push(`${call.instructions ?? ""}\n${String(call.input)}`);
      return String(call.input).includes("Days since their last quiz: 2\n");
    };
    const { sim, phone, coachSaid } = returning({
      recorded: { ...RECORDED, worded },
      steps: model.steps,
    });
    sim().setConsent({ messages: true, quiet_hours: null, intensity: "normal" });

    await sim().set(5);

    expect(asked).toHaveLength(2);
    expect(model.calls.map((c) => c.prompt)).toEqual(asked.slice(0, 1));
    expect(phone().map((m) => m.text)).toEqual([
      "عمر، خطوة صغيرة اليوم تكفي.",
      "عمر، يبدو أن أسبوعك مزدحم. يمكن أن نجعله أخف: جلسات أقصر والهدف نفسه. افتح خطتك واختر ما يناسبك.",
    ]);
    expect(coachSaid().filter((s) => s.startsWith("replan_a0_d5"))).toEqual([
      "replan_a0_d5: template, no model call: replay has no recording of its wording",
    ]);
  });

  it("words the messages to the learner's own plan in the recorded gentle tone", async () => {
    const model = fakeCoachModel(() => "{name}، خطوة صغيرة اليوم تكفي.");
    const { sim, coachSaid } = returning({ recorded: RECORDED, steps: model.steps });
    sim().setConsent({ messages: true, quiet_hours: null, intensity: "normal" });

    await sim().set(2);

    expect(model.calls.map((c) => c.prompt.match(/^Tone: .*$/m)?.[0])).toEqual([
      "Tone: gentle: one or two short, soft sentences, at most 160 characters",
    ]);
    expect(coachSaid()).toContainEqual(
      expect.stringMatching(
        /: replay words it in the recorded gentle tone, not the learner's normal$/,
      ),
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
