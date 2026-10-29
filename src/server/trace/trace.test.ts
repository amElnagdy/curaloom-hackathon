import { mkdtempSync } from "node:fs";
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

it("continues ids and the total from a trace written by an earlier process", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-"));
  createTracer(createFileStore(dir), "s_1", clock).emit({ ...event, cost_usd: 0.25 });

  const resumed = createTracer(createFileStore(dir), "s_1", clock).emit({ ...event, cost_usd: 1 });

  expect(resumed).toMatchObject({ id: "evt_0002", total_cost_usd: 1.25 });
});
