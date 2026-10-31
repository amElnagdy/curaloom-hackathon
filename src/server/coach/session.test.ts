import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createSim } from "../clock/sim";
import { readInbox } from "../notifier/adapters";
import { createFileStore } from "../store/store";
import { sessionSimSeed } from "./session";

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
      quiet_hours: { start: "22:00", end: "08:00" },
      opted_out: false,
      opted_out_sim_day: null,
      intensity: "gentle",
    });
  });

  it("lets no coach message reach the interviewed learner before consent is saved", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);
    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });

    const { events } = sim.set(3);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.status === "suppressed_opt_out")).toBe(true);
  });

  it("hands the interviewed learner nothing the seed's Omar agreed to, was sent or replied before the intake", () => {
    const s = store();
    const omar = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });
    omar.setConsent({ messages: true, quiet_hours: null, intensity: "normal" });
    omar.set(3);
    omar.reply("شكرًا");
    s.writeDoc("s1", "profile", learner);

    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });

    expect(sim.consent()).toMatchObject({ learner_id: "l_new", granted: false, opted_out: false });
    expect(sim.coachEvents()).toEqual([]);
    expect(sim.outbox()).toEqual([]);
    expect(readInbox(s, "s1")).toEqual([]);
    expect(sim.set(5).events.every((e) => e.status === "suppressed_opt_out")).toBe(true);
  });

  it("keeps the interviewed learner's own consent from one request to the next", () => {
    const s = store();
    s.writeDoc("s1", "profile", learner);
    const open = () =>
      createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });

    open().setConsent({ messages: true, quiet_hours: null, intensity: "gentle" });

    expect(open().consent()).toMatchObject({ learner_id: "l_new", granted: true });
  });

  it("marks a held coach event as not sent once the consent screen turns messages off", () => {
    const s = store();
    const sim = createSim({ store: s, sessionId: "s1", seed: sessionSimSeed(s, "s1", seed) });
    sim.set(2);
    expect(sim.coachEvents().find((e) => e.id === "c1")?.status).toBe("queued");

    sim.setConsent({ messages: false, quiet_hours: null, intensity: "gentle" });

    expect(sim.coachEvents().find((e) => e.id === "c1")?.status).toBe("suppressed_opt_out");
  });
});
