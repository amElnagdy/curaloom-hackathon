import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFileStore } from "../store/store";
import { createTracer, type TraceClock, type TraceEvent } from "./trace";

const clock: TraceClock = { wall: () => new Date("2026-10-29T10:00:00Z"), sim: () => null };
const event = { agent: "a", kind: "decision", summary_ar: "س", summary_en: "e" } as const;

it("keeps ids unique and the cost total running across tracers on one session", () => {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "trace-")));
  const first = createTracer(store, "s_1", clock);
  const second = createTracer(store, "s_1", clock);

  first.emit({ ...event, cost_usd: 0.25 });
  second.emit({ ...event, cost_usd: 0.5 });
  first.emit(event);

  const trace = store.readTrace<TraceEvent>("s_1");
  expect(trace.map((e) => e.id)).toEqual(["evt_0001", "evt_0002", "evt_0003"]);
  expect(trace[1]?.total_cost_usd).toBe(0.75);
});

it("keeps ids unique across requests that each open the store while the other still traces", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-"));
  const building = createTracer(createFileStore(dir), "s_1", clock);
  const quizzing = createTracer(createFileStore(dir), "s_1", clock);

  building.emit(event);
  quizzing.emit(event);
  building.emit(event);

  const ids = createFileStore(dir)
    .readTrace<TraceEvent>("s_1")
    .map((e) => e.id);
  expect(ids).toEqual(["evt_0001", "evt_0002", "evt_0003"]);
});

it("continues ids and the total from a trace written by an earlier process", () => {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "trace-")));
  const earlier = { ...event, id: "evt_0001", cost_usd: 0.25 };
  store.appendTrace("s_1", earlier);

  const resumed = createTracer(store, "s_1", clock).emit({ ...event, cost_usd: 1 });

  expect(resumed).toMatchObject({ id: "evt_0002", total_cost_usd: 1.25 });
});

// `pnpm demo:reset` deletes the data folder under the running server; `rm -rf data/sessions/<id>`
// deletes one session's.
it.each([
  ["the data folder", (dir: string) => dir],
  ["the session folder", (dir: string) => join(dir, "sessions", "s_1")],
])("starts the ids and the total again once %s is deleted under the server", (_, deleted) => {
  const dir = mkdtempSync(join(tmpdir(), "trace-"));
  const tracer = createTracer(createFileStore(dir), "s_1", clock);
  tracer.emit({ ...event, cost_usd: 1.4 });
  tracer.emit(event);

  rmSync(deleted(dir), { recursive: true, force: true });
  const after = createTracer(createFileStore(dir), "s_1", clock).emit({ ...event, cost_usd: 0.5 });

  expect(after).toMatchObject({ id: "evt_0001", total_cost_usd: 0.5 });
  expect(
    createFileStore(dir)
      .readTrace<TraceEvent>("s_1")
      .map((e) => e.id),
  ).toEqual(["evt_0001"]);
});

it("traces a request replay has no recording for as an error that names its hash, for the UI to show", () => {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "trace-")));
  const tracer = createTracer(store, "s_1", clock);

  const traced = tracer.fromProvider({
    kind: "model_call",
    agent: "intake",
    summary_ar: "يقرأ رسالتك",
    summary_en: "Reading the message",
    role: "agent_default",
    model: "muse-spark-1.3",
    profile: "replay",
    attempt: 1,
    ok: false,
    latency_ms: 0,
    cost_usd: 0,
    total_cost_usd: 0,
    error: "No recorded response for request 0123456789abcdef",
    missing_recording: "0123456789abcdef",
  });

  expect(traced).toMatchObject({ kind: "error", missing_recording: "0123456789abcdef" });
  expect(traced.summary_ar).toContain("0123456789abcdef");
  expect(traced.summary_en).toContain("0123456789abcdef");
});
