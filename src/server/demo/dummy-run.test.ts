import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileStore } from "../store/store";
import type { TraceEvent } from "../trace/trace";
import { createDummyRunner } from "./dummy-run";

function setup() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "dummy-")));
  const sleeps: number[] = [];
  const runner = createDummyRunner({
    store,
    sleep: async (ms) => void sleeps.push(ms),
    clock: { wall: () => new Date("2026-10-28T16:00:00Z"), sim: () => null },
  });
  return { store, runner, sleeps };
}

describe("dummy run", () => {
  it("traces both attempts and the orchestrator's retry, in order, without calling a model", async () => {
    const { store, runner, sleeps } = setup();

    const outcome = await runner.start("s_1");

    expect(outcome).toMatchObject({ status: "done", key: "dummy:1" });
    const events = store.readTrace<TraceEvent>("s_1");
    expect(events.map((e) => e.id)).toEqual(
      events.map((_, i) => `evt_${String(i + 1).padStart(4, "0")}`),
    );
    expect(events.every((e) => e.agent === "dummy")).toBe(true);
    expect(events.some((e) => e.kind === "model_call")).toBe(false);
    for (const e of events) {
      expect(e.summary_ar).toMatch(/[؀-ۿ]/);
      expect(e.summary_en).toMatch(/[A-Za-z]/);
    }

    expect(events[0]?.summary_en).toBe("Starting step dummy:1");
    const errors = events.filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.summary_en).toMatch(/^dummy:1 attempt 1 failed; retrying once: \/checked/);
    const retryAt = events.indexOf(errors[0] as TraceEvent);
    const firstAttempt = events.slice(1, retryAt);
    const secondAttempt = events.slice(retryAt + 1, -1);
    expect(firstAttempt.filter((e) => e.kind === "tool_call").length).toBeGreaterThan(0);
    expect(secondAttempt[0]).toMatchObject({
      kind: "decision",
      summary_en: expect.stringMatching(/\/checked/),
    });
    expect(secondAttempt.filter((e) => e.kind === "tool_call").length).toBeGreaterThan(0);

    const output = events.at(-1);
    expect(output?.kind).toBe("output");
    expect(store.readBlob("s_1", output?.payload_ref ?? "")).toEqual(
      outcome?.status === "done" ? outcome.output : null,
    );
    const seconds = sleeps.reduce((sum, ms) => sum + ms, 0) / 1000;
    expect(seconds).toBeGreaterThanOrEqual(8);
    expect(seconds).toBeLessThanOrEqual(12);
  });

  it("refuses a second run of a session while one is running, then runs again under a new key", async () => {
    const { store, runner } = setup();

    const first = runner.start("s_1");
    expect(runner.start("s_1")).toBeNull();
    await first;
    const second = await runner.start("s_1");

    expect(second).toMatchObject({ status: "done", key: "dummy:2" });
    const starts = store
      .readTrace<TraceEvent>("s_1")
      .filter((e) => e.summary_en.startsWith("Starting step"))
      .map((e) => e.summary_en);
    expect(starts).toEqual(["Starting step dummy:1", "Starting step dummy:2"]);
  });

  it("rejects a session id the store would not accept", () => {
    const { runner } = setup();

    expect(() => runner.start("../etc")).toThrow(/Invalid session id/);
  });
});
