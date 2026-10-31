import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareSimTime, type SimTime, startOfDay } from "../clock/time";
import {
  LADDER_STATES,
  type LadderFacts,
  ladderAt,
  ladderMarks,
  pauseFor,
  rungsThrough,
} from "./ladder";

const facts = (over: Partial<LadderFacts> = {}): LadderFacts => ({
  anchor: 0,
  pause: null,
  messages_on: true,
  ...over,
});
const ids = (f: LadderFacts, upTo: SimTime) => rungsThrough(f, upTo).map((r) => r.id);
const DAY_10_1230: SimTime = { day: 10, minute: 12 * 60 + 30 };

// The issue's transitions for a learner whose last quiz was on day 0, at 09:00 of each day.
const TABLE = [
  { day: 0, state: "active", fired: [], next: "nudge_a0_d2" },
  { day: 1, state: "active", fired: [], next: "nudge_a0_d2" },
  { day: 2, state: "nudged_d2", fired: ["nudge_a0_d2"], next: "replan_a0_d5" },
  {
    day: 5,
    state: "replan_offered_d5",
    fired: ["nudge_a0_d2", "replan_a0_d5"],
    next: "checkin_a0_d10",
  },
  {
    day: 10,
    state: "checkin_d10",
    fired: ["nudge_a0_d2", "replan_a0_d5", "checkin_a0_d10"],
    next: "weekly_a0_d17",
  },
  {
    day: 17,
    state: "weekly",
    fired: ["nudge_a0_d2", "replan_a0_d5", "checkin_a0_d10", "weekly_a0_d17"],
    next: "weekly_a0_d24",
  },
  {
    day: 24,
    state: "weekly",
    fired: ["nudge_a0_d2", "replan_a0_d5", "checkin_a0_d10", "weekly_a0_d17", "weekly_a0_d24"],
    next: "weekly_a0_d31",
  },
];

describe("the ladder after the last quiz", () => {
  it.each(TABLE)("is $state on day $day", ({ day, state, fired, next }) => {
    const now = startOfDay(day);

    expect(ladderAt(facts(), now)).toEqual(
      expect.objectContaining({
        state,
        anchor: 0,
        inactive_days: day,
        next: expect.objectContaining({ id: next }),
        paused_until: null,
      }),
    );
    expect(ids(facts(), now)).toEqual(fired);
  });

  it("reaches a rung only at 09:00 of its day", () => {
    const before = { day: 2, minute: 8 * 60 + 59 };

    expect(ladderAt(facts(), before).state).toBe("active");
    expect(ids(facts(), before)).toEqual([]);
  });

  it("counts from the day of the last quiz", () => {
    const f = facts({ anchor: 3 });

    expect(ids(f, startOfDay(27))).toEqual([
      "nudge_a3_d5",
      "replan_a3_d8",
      "checkin_a3_d13",
      "weekly_a3_d20",
      "weekly_a3_d27",
    ]);
    expect(rungsThrough(f, startOfDay(13)).at(-1)).toEqual({
      id: "checkin_a3_d13",
      kind: "d10",
      type: "checkin",
      state: "checkin_d10",
      at: startOfDay(13),
      inactive_days: 10,
    });
    expect(ladderAt(f, startOfDay(4))).toMatchObject({ state: "active", inactive_days: 1 });
  });

  it("marks the demo bar with the rungs through day 24", () => {
    expect(ladderMarks()).toEqual([
      { day: 2, type: "nudge" },
      { day: 5, type: "replan" },
      { day: 10, type: "checkin" },
      { day: 17, type: "weekly" },
      { day: 24, type: "weekly" },
    ]);
  });
});

describe("a pause", () => {
  it("holds every rung until it ends, then the ladder carries on where the days put it", () => {
    const f = facts({ pause: pauseFor(0, DAY_10_1230, 10) });

    for (let day = 11; day <= 19; day++) {
      expect(ladderAt(f, startOfDay(day))).toMatchObject({
        state: "paused",
        paused_until: startOfDay(20),
        next: { id: "weekly_a0_d24" },
      });
    }
    expect(ladderAt(f, startOfDay(10)).state).toBe("checkin_d10");
    expect(ids(f, startOfDay(24))).toEqual([
      "nudge_a0_d2",
      "replan_a0_d5",
      "checkin_a0_d10",
      "weekly_a0_d24",
    ]);
    expect(ladderAt(f, startOfDay(20))).toMatchObject({
      state: "weekly",
      paused_until: null,
      next: { id: "weekly_a0_d24" },
    });
  });

  it("of 7 days ends as the day 17 message falls due", () => {
    const f = facts({ pause: pauseFor(0, DAY_10_1230, 7) });

    for (let day = 11; day <= 16; day++) {
      expect(ladderAt(f, startOfDay(day)).state).toBe("paused");
    }
    expect(ladderAt(f, startOfDay(17)).state).toBe("weekly");
    expect(ids(f, startOfDay(17))).toContain("weekly_a0_d17");
  });

  it("chosen before the last quiz no longer holds anything", () => {
    const f = facts({ anchor: 12, pause: pauseFor(0, DAY_10_1230, 10) });

    expect(ladderAt(f, startOfDay(14))).toMatchObject({ state: "nudged_d2", paused_until: null });
    expect(ids(f, startOfDay(17))).toEqual(["nudge_a12_d14", "replan_a12_d17"]);
  });

  it("never lets a rung through, and weekly messages stay at least a week apart", () => {
    for (let anchor = 0; anchor <= 3; anchor++) {
      for (let from = anchor; from <= anchor + 30; from++) {
        for (let days = 1; days <= 30; days++) {
          const pause = pauseFor(anchor, { day: from, minute: 12 * 60 + 30 }, days);
          const rungs = rungsThrough(facts({ anchor, pause }), startOfDay(anchor + 80));
          const held = rungs.filter(
            (r) => compareSimTime(pause.from, r.at) <= 0 && compareSimTime(r.at, pause.until) < 0,
          );
          const weekly = rungs.filter((r) => r.kind === "weekly").map((r) => r.at.day);

          expect(held).toEqual([]);
          expect(weekly.every((day, i) => i === 0 || day - (weekly[i - 1] as number) >= 7)).toBe(
            true,
          );
        }
      }
    }
  });
});

describe("with messages off", () => {
  it.each(TABLE)("is opted out on day $day, and its rungs still fall due", ({ day, fired }) => {
    const f = facts({ messages_on: false });

    expect(ladderAt(f, startOfDay(day)).state).toBe("opted_out");
    expect(ids(f, startOfDay(day))).toEqual(fired);
  });
});

describe("the statechart in docs/coach.md", () => {
  it("draws every ladder state, and no other", () => {
    const doc = readFileSync(join(process.cwd(), "docs/coach.md"), "utf8");
    const chart = doc.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";

    const drawn = new Set(
      [...chart.matchAll(/^\s*(\[\*\]|\w+)\s*-->\s*(\w+)/gm)].flatMap((m) => [m[1], m[2]]),
    );
    drawn.delete("[*]");

    expect([...drawn].sort()).toEqual([...LADDER_STATES].sort());
  });
});
