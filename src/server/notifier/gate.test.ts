import { describe, expect, it } from "vitest";
import type { Consent } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed";
import { formatSimTime, parseSimTime } from "../clock/time";
import { gate, type MessageKind } from "./gate";

// The seed's consent: granted, quiet hours 22:00 to 12:00 (across midnight).
const SEED = loadOmarSeed("x").consent;
const consent = (change: Partial<Consent> = {}): Consent => ({ ...SEED, ...change });

const decide = (c: Consent, at: string, kind?: MessageKind) => {
  const decision = gate(c, parseSimTime(at), kind);
  return decision.status === "deferred"
    ? `deferred to ${formatSimTime(decision.deliver_at)}`
    : decision.status;
};

describe("consent gate", () => {
  it.each([
    ["day 2 19:00", "send"],
    ["day 2 21:59", "send"],
    ["day 2 22:00", "deferred to day 3 12:00"],
    ["day 2 23:30", "deferred to day 3 12:00"],
    ["day 3 00:00", "deferred to day 3 12:00"],
    ["day 3 09:00", "deferred to day 3 12:00"],
    ["day 3 11:59", "deferred to day 3 12:00"],
    ["day 3 12:00", "send"],
  ])("with quiet hours 22:00 to 12:00, a message at %s: %s", (at, expected) => {
    expect(decide(consent(), at)).toBe(expected);
  });

  it("defers inside a window that does not cross midnight, to its end that day", () => {
    const afternoon = consent({ quiet_hours: { start: "13:00", end: "15:00" } });

    expect(decide(afternoon, "day 4 14:30")).toBe("deferred to day 4 15:00");
    expect(decide(afternoon, "day 4 09:00")).toBe("send");
  });

  it("sends at any hour without quiet hours", () => {
    expect(decide(consent({ quiet_hours: null }), "day 4 03:00")).toBe("send");
  });

  it("suppresses every coach message while opted out or before consent, quiet hours or not", () => {
    for (const at of ["day 2 19:00", "day 2 23:00"]) {
      expect(decide(consent({ opted_out: true }), at)).toBe("suppressed_opt_out");
      expect(decide(consent({ granted: false }), at)).toBe("suppressed_opt_out");
    }
  });

  it("lets the opt-out confirmation through at once, even in quiet hours", () => {
    expect(decide(consent({ opted_out: true }), "day 2 23:00", "opt_out_confirmation")).toBe(
      "send",
    );
  });
});
