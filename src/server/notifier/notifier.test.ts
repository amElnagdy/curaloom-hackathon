import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Consent } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed";
import { parseSimTime } from "../clock/time";
import { createFileStore } from "../store/store";
import { createTracer, type TraceEvent } from "../trace/trace";
import { createAdapter, readInbox } from "./adapters";
import { createNotifier, type NotifierMessage } from "./notifier";

// The seed's consent: granted, quiet hours 22:00 to 12:00.
function setup(change: Partial<Consent> = {}) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "notifier-")));
  const notifier = createNotifier({
    store,
    sessionId: "s_1",
    adapter: createAdapter("simulated", store, "s_1"),
    tracer: createTracer(store, "s_1"),
    initialConsent: { ...loadOmarSeed("x").consent, ...change },
  });
  const phone = () => readInbox(store, "s_1");
  const received = () => phone().filter((e) => e.direction === "out");
  return { store, notifier, phone, received };
}

const message = (id: string, sim_ts: string): NotifierMessage => ({
  id,
  to: "l_omar",
  channel: "simulated",
  template: `nudge_${id}`,
  text_ar: `رسالة ${id}`,
  cta: null,
  sim_ts,
});

describe("notifier", () => {
  it("delivers a message outside quiet hours at once", () => {
    const { notifier, received } = setup();

    const result = notifier.send(message("m1", "day 2 19:00"));

    expect(result).toEqual({ status: "sent", deliver_at: "day 2 19:00" });
    expect(received().map((e) => [e.id, e.sim_ts])).toEqual([["m1", "day 2 19:00"]]);
  });

  it("defers a message in quiet hours and delivers it once the tick passes the end", () => {
    const { notifier, received } = setup();

    const result = notifier.send(message("m1", "day 2 23:00"));
    const early = notifier.deliverDue(parseSimTime("day 3 11:59"));
    const due = notifier.deliverDue(parseSimTime("day 3 12:00"));
    const again = notifier.deliverDue(parseSimTime("day 4 12:00"));

    expect(result).toEqual({ status: "deferred", deliver_at: "day 3 12:00" });
    expect(early).toEqual([]);
    expect(due.map((e) => [e.message.id, e.status])).toEqual([["m1", "sent"]]);
    expect(again).toEqual([]);
    expect(received().map((e) => [e.id, e.sim_ts])).toEqual([["m1", "day 3 12:00"]]);
  });

  it("sends a message id once, however often it is sent", () => {
    const { notifier, received } = setup();

    notifier.send(message("m1", "day 2 19:00"));
    const repeat = notifier.send(message("m1", "day 3 19:00"));

    expect(repeat).toEqual({ status: "sent", deliver_at: "day 2 19:00" });
    expect(received()).toHaveLength(1);
  });

  it("delivers nothing before consent is granted", () => {
    const { notifier, received } = setup({ granted: false, granted_sim_day: null });

    expect(notifier.send(message("m1", "day 2 19:00")).status).toBe("suppressed_opt_out");
    expect(received()).toEqual([]);
  });

  it("refuses a message longer than the channel allows", () => {
    const { notifier } = setup();

    expect(() =>
      notifier.send({ ...message("m1", "day 2 19:00"), text_ar: "ا".repeat(1001) }),
    ).toThrow(/longer than 1000/);
  });

  it("traces each decision in Arabic and English with the learner id and no message text", () => {
    const { store, notifier } = setup();

    notifier.send(message("m1", "day 2 19:00"));
    notifier.send(message("m2", "day 2 23:00"));
    notifier.receive("توقف", parseSimTime("day 2 23:30"));

    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) {
      expect(e.agent).toBe("notifier");
      expect(e.summary_ar).toMatch(/[؀-ۿ]/);
      expect(e.summary_en).toContain("l_omar");
      expect(`${e.summary_ar} ${e.summary_en}`).not.toMatch(/رسالة m\d|توقف"/);
    }
    expect(events.map((e) => e.sim_ts)).toEqual(
      events.map((_, i) => (i === 0 ? "day 2 19:00" : i === 1 ? "day 2 23:00" : "day 2 23:30")),
    );
  });
});

describe("opt-out", () => {
  it.each([
    "توقف",
    "توقّف",
    "تـــوقــف",
    "توقف!!",
    "؟توقف.",
    "  STOP ",
    "Stop!",
    "إيقاف",
    "إِيقَاف",
    "ايقاف",
    "أوقف",
    "ﺗﻮﻗﻒ",
    "إيقاف الرسائل",
    "توقف من فضلك",
    "رجاءً أوقف الرسائل",
    "أوقفوا الرسائل لو سمحتم",
    "please stop",
    "Stop, please.",
    "أوقف الرسايل",
    "ايقاف الرسايل",
    "وقف",
    "وقف الرسايل",
    "توقف عن الرسائل",
    "stop messages",
    "unsubscribe",
  ])("opts out on %j", (text) => {
    const { notifier } = setup();

    expect(notifier.receive(text, parseSimTime("day 2 19:00"))).toEqual({
      opted_out: true,
      confirmed: true,
    });
    expect(notifier.consent()).toMatchObject({ opted_out: true, opted_out_sim_day: 2 });
  });

  it.each(["شكرًا", "لا تتوقف", "توقف الفيديو عندي", "stopwatch"])(
    "treats %j as a reply, not a stop",
    (text) => {
      const { notifier, phone } = setup();

      expect(notifier.receive(text, parseSimTime("day 2 19:00")).opted_out).toBe(false);
      expect(phone().map((e) => [e.direction, e.text])).toEqual([["in", text]]);
    },
  );

  it("opts out in any state, with exactly one confirmation, even in quiet hours", () => {
    const { notifier, phone } = setup({ granted: true });

    const first = notifier.receive("توقف", parseSimTime("day 2 23:00"));
    const second = notifier.receive("STOP", parseSimTime("day 3 19:00"));

    expect(first).toEqual({ opted_out: true, confirmed: true });
    expect(second).toEqual({ opted_out: true, confirmed: false });
    expect(phone().map((e) => [e.direction, e.template ?? e.text, e.sim_ts])).toEqual([
      ["in", "توقف", "day 2 23:00"],
      ["out", "opt_out_confirmation", "day 2 23:00"],
      ["in", "STOP", "day 3 19:00"],
    ]);
  });

  it("sends nothing after an opt-out, on any path", () => {
    const { notifier, received } = setup();
    const deferred = notifier.send(message("before", "day 2 23:00"));

    notifier.receive("توقف", parseSimTime("day 2 23:10"));
    const results = [
      notifier.send(message("evening", "day 3 19:00")),
      notifier.send(message("night", "day 3 23:00")),
    ];
    const flushed = notifier.deliverDue(parseSimTime("day 30 12:00"));

    expect(deferred.status).toBe("deferred");
    expect(results.map((r) => r.status)).toEqual(["suppressed_opt_out", "suppressed_opt_out"]);
    expect(flushed).toEqual([]);
    expect(notifier.outbox().map((e) => [e.message.id, e.status])).toEqual([
      ["before", "suppressed_opt_out"],
      ["evening", "suppressed_opt_out"],
      ["night", "suppressed_opt_out"],
    ]);
    expect(received().map((e) => e.template)).toEqual(["opt_out_confirmation"]);
  });

  it("asks the gate again when a deferred message comes due, so consent withdrawn since holds", () => {
    const { store, notifier, received } = setup();
    notifier.send(message("m1", "day 2 23:00"));
    // Consent withdrawn by another path than a stop word, e.g. a future consent page.
    store.writeDoc("s_1", "consent", { ...notifier.consent(), granted: false });

    const flushed = notifier.deliverDue(parseSimTime("day 3 12:00"));

    expect(flushed.map((e) => e.status)).toEqual(["suppressed_opt_out"]);
    expect(received()).toEqual([]);
  });
});

describe("adapters", () => {
  it("sends nothing until the learner saves consent, then sends", () => {
    const { notifier, received } = setup({ granted: false, granted_sim_day: null });

    const before = notifier.send(message("m1", "day 1 19:00"));
    const consent = notifier.setConsent(
      { messages: true, quiet_hours: { start: "22:00", end: "08:00" }, intensity: "normal" },
      parseSimTime("day 2 18:00"),
    );
    const after = notifier.send(message("m2", "day 2 19:00"));

    expect(before.status).toBe("suppressed_opt_out");
    expect(consent).toMatchObject({ granted: true, granted_sim_day: 2, opted_out: false });
    expect(after.status).toBe("sent");
    expect(received().map((e) => e.id)).toEqual(["m2"]);
  });

  it("defers to the new end of quiet hours once the learner changes them", () => {
    const { notifier } = setup();
    const at = parseSimTime("day 2 08:00");

    const early = notifier.send(message("m1", "day 2 07:00"));
    notifier.setConsent(
      { messages: true, quiet_hours: { start: "21:00", end: "07:00" }, intensity: "gentle" },
      at,
    );
    const later = notifier.send(message("m2", "day 2 23:00"));

    expect(early).toEqual({ status: "deferred", deliver_at: "day 2 12:00" });
    expect(later).toEqual({ status: "deferred", deliver_at: "day 3 07:00" });
  });

  it("moves a held message to the new end of quiet hours, or delivers it at once when they have ended", () => {
    const { notifier, received } = setup();
    const quiet = (start: string, end: string, at: string) =>
      notifier.setConsent(
        { messages: true, quiet_hours: { start, end }, intensity: "gentle" },
        parseSimTime(at),
      );
    notifier.send(message("m1", "day 2 07:00"));
    quiet("21:00", "07:00", "day 2 08:00");
    notifier.send(message("m2", "day 2 23:00"));
    quiet("22:00", "06:00", "day 2 23:30");

    expect(notifier.outbox().map((e) => [e.message.id, e.status, e.deliver_at])).toEqual([
      ["m1", "sent", "day 2 08:00"],
      ["m2", "deferred", "day 3 06:00"],
    ]);
    expect(received().map((e) => e.id)).toEqual(["m1"]);
  });

  it("keeps the first grant's day when messages come back on after a stop word", () => {
    const { notifier } = setup();
    notifier.receive("توقف", parseSimTime("day 3 10:00"));

    const consent = notifier.setConsent(
      { messages: true, quiet_hours: { start: "22:00", end: "12:00" }, intensity: "gentle" },
      parseSimTime("day 4 10:00"),
    );

    expect(consent).toMatchObject({ granted: true, granted_sim_day: 0, opted_out: false });
  });

  it("opts out from the consent screen like a stop word, without a confirmation message", () => {
    const { notifier, received } = setup();
    notifier.send(message("m1", "day 2 23:00"));

    const consent = notifier.setConsent(
      { messages: false, quiet_hours: { start: "22:00", end: "12:00" }, intensity: "gentle" },
      parseSimTime("day 2 23:30"),
    );

    expect(consent).toMatchObject({ opted_out: true, opted_out_sim_day: 2, granted: true });
    expect(notifier.outbox().map((e) => [e.message.id, e.status])).toEqual([
      ["m1", "suppressed_opt_out"],
    ]);
    expect(notifier.deliverDue(parseSimTime("day 3 12:00"))).toEqual([]);
    expect(received()).toEqual([]);
  });

  it("whatsapp and email are stubs that throw instead of sending", () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "adapters-")));
    for (const name of ["whatsapp", "email"] as const) {
      const adapter = createAdapter(name, store, "s_1");
      expect(() => adapter.deliver(message("m1", "day 2 19:00"))).toThrow(/stub and sends nothing/);
      expect(() => adapter.capabilities()).toThrow(/NOTIFIER_ADAPTER=simulated/);
    }
  });
});
