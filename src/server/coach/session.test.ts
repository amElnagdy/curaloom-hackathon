import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CoursePlan, QuizAttempt } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed";
import { createSim } from "../clock/sim";
import { readInbox } from "../notifier/adapters";
import { contentHash, createFileStore } from "../store/store";
import { COACH_DOC } from "./coach";
import { sessionSim, sessionSimSeed, studyOf } from "./session";

const seed = loadOmarSeed("x");
const store = () => createFileStore(mkdtempSync(join(tmpdir(), "coach-session-")));
const learner = { ...seed.profile, id: "l_new", name: "سارة" };

describe("sessionSimSeed", () => {
  it("is the seed's Omar before the intake", () => {
    expect(sessionSimSeed(store(), "s1", seed)).toEqual(seed);
  });

  it("gives the interviewed learner no consent and no coach events until the consent screen saves", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);

    const sim = sessionSimSeed(s, "s1", seed);

    expect(sim.profile).toEqual(learner);
    expect(sim.coach_events).toEqual([]);
    expect(sim.consent).toEqual({
      learner_id: "l_new",
      channel: "simulated",
      granted: false,
      granted_sim_day: null,
      quiet_hours: { start: "22:00", end: "12:00" },
      opted_out: false,
      opted_out_sim_day: null,
      intensity: "gentle",
    });
  });

  it("lets no coach message reach the interviewed learner before consent is saved", async () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);
    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });

    const { events } = await sim.set(3);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.status === "suppressed_opt_out")).toBe(true);
  });

  it("hands the interviewed learner nothing the seed's Omar agreed to, was sent or replied before the intake", async () => {
    const s = store();
    const omar = sessionSim(s, "s1", seed).sim;
    omar.setConsent({ messages: true, quiet_hours: null, intensity: "normal" });
    await omar.set(3);
    omar.reply("شكرًا");
    s.writeDoc("s1", "profile", learner);

    const sim = sessionSim(s, "s1", seed).sim;

    expect(sim.consent()).toMatchObject({ learner_id: "l_new", granted: false, opted_out: false });
    expect(sim.coachEvents()).toEqual([]);
    expect(sim.outbox()).toEqual([]);
    expect(readInbox(s, "s1")).toEqual([]);
    expect(s.readDoc("s1", COACH_DOC)).toBeUndefined();
    expect((await sim.set(5)).events.every((e) => e.status === "suppressed_opt_out")).toBe(true);
  });

  it("keeps the interviewed learner's own consent from one request to the next", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);
    const open = () =>
      createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });

    open().setConsent({ messages: true, quiet_hours: null, intensity: "gentle" });

    expect(open().consent()).toMatchObject({ learner_id: "l_new", granted: true });
  });

  it("marks a held coach event as not sent once the consent screen turns messages off", async () => {
    const s = store();
    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });
    // Stay at 09:00 of day 2, inside his quiet hours, so the nudge is still held.
    await sim.advance({ days: 2 });
    expect(sim.coachEvents().find((e) => e.id === "nudge_a0_d2")?.status).toBe("queued");

    sim.setConsent({ messages: false, quiet_hours: null, intensity: "gentle" });

    expect(sim.coachEvents().find((e) => e.id === "nudge_a0_d2")?.status).toBe(
      "suppressed_opt_out",
    );
  });
});

// Omar's interview (and the seed's notes) ask for no morning messages. After the intake that
// preference is the consent form's default, and a jump to a coach day lands when quiet hours end,
// so the phone shows the message at noon, not 09:00 (#118).
describe("the interviewed learner's no-morning preference", () => {
  const noMorning = {
    ...learner,
    history_notes: "ترك كورسات كورسيرا لأنها طويلة ويمل بسرعة، ويفضل عدم مراسلته في الصباح",
  };

  it("covers the morning in quiet hours and sends the day-5 message at 12:00", async () => {
    const s = store();
    s.writeDoc("s1", "profile", noMorning);
    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });
    sim.setConsent({
      messages: true,
      quiet_hours: sim.consent().quiet_hours,
      intensity: "gentle",
    });

    const { now, events } = await sim.set(5);

    expect(sim.consent().quiet_hours).toEqual({ start: "22:00", end: "12:00" });
    expect(now).toBe("day 5 12:00");
    expect(events.find((e) => e.id === "replan_a0_d5")?.status).toBe("sent");
    expect(readInbox(s, "s1").find((m) => m.id === "replan_a0_d5")?.sim_ts).toBe("day 5 12:00");
  });

  it("keeps the usual 08:00 quiet end and a 09:00 send when the notes do not mention mornings", async () => {
    const s = store();
    s.writeDoc("s1", "profile", {
      ...learner,
      history_notes: "ترك دورات طويلة لأنها مملة",
    });
    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });
    sim.setConsent({
      messages: true,
      quiet_hours: sim.consent().quiet_hours,
      intensity: "gentle",
    });

    const { now, events } = await sim.set(5);

    expect(sim.consent().quiet_hours).toEqual({ start: "22:00", end: "08:00" });
    expect(now).toBe("day 5 09:00");
    expect(events.find((e) => e.id === "replan_a0_d5")?.status).toBe("sent");
  });
});

describe("studyOf", () => {
  const plan = seed.plans[0] as CoursePlan;
  const passedL1: QuizAttempt = {
    ...(seed.attempts[0] as QuizAttempt),
    id: "a_new",
    sim_day: 3,
    score: 1,
    passed: true,
  };

  it("is the seed's quiz on day 0 and lesson L1 at 75% before the intake, on no plan of his own", () => {
    expect(studyOf(store(), "s1", seed)).toEqual({
      attempt_days: [0],
      lesson: {
        id: "L1",
        title_ar: "الجدول المحوري: تلخيص آلاف الصفوف في دقيقة",
        best_percent: 75,
      },
      own_plan: false,
    });
  });

  it("is nothing studied for an interviewed learner without a plan", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);

    expect(studyOf(s, "s1", seed)).toEqual({ attempt_days: [], lesson: null, own_plan: false });
  });

  it("is the quizzes on the learner's own plan, and the first lesson they have not passed", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);
    s.writeDoc("s1", "plan", {
      for_profile: contentHash(learner),
      versions: [plan],
      resources: seed.resources,
      limits: { budget_minutes: 300, resource_ids: ["r1", "r2"] },
    });
    s.writeDoc("s1", "quizzes", {
      for_plan: plan.id,
      quizzes: seed.quizzes,
      attempts: [passedL1],
      mastery: [{ lesson_id: "L1", best_score: 1, passed: true, attempts: 1 }],
    });

    expect(studyOf(s, "s1", seed)).toEqual({
      attempt_days: [3],
      lesson: { id: "L2", title_ar: "الإحصاء الوصفي: المتوسط والوسيط والتشتت", best_percent: null },
      own_plan: true,
    });
  });
});
