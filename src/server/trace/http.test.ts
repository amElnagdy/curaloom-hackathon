import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileStore } from "../store/store";
import { traceJson, traceStream } from "./http";
import { createTracer } from "./trace";

function seeded() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "http-")));
  const tracer = createTracer(store, "s_1", {
    wall: () => new Date("2026-10-28T16:00:00Z"),
    sim: () => null,
  });
  for (const n of [1, 2, 3]) {
    tracer.emit({
      agent: "scout",
      kind: "decision",
      summary_ar: `خطوة ${n}`,
      summary_en: `Step ${n}`,
    });
  }
  return { store, tracer };
}

describe("trace JSON endpoint", () => {
  it("returns a session's events in order, after an optional cursor", async () => {
    const { store } = seeded();

    const all = await traceJson(store, "s_1", null).json();
    const later = await traceJson(store, "s_1", "evt_0001").json();

    expect(all.events.map((e: { id: string }) => e.id)).toEqual([
      "evt_0001",
      "evt_0002",
      "evt_0003",
    ]);
    expect(later.events.map((e: { id: string }) => e.id)).toEqual(["evt_0002", "evt_0003"]);
  });

  it("answers 400 for an invalid session id", () => {
    const { store } = seeded();

    expect(traceJson(store, "../x", null).status).toBe(400);
  });
});

describe("trace SSE endpoint", () => {
  it("sends saved events, then new ones as they are written", async () => {
    const { store, tracer } = seeded();
    const abort = new AbortController();
    const res = traceStream(store, "s_1", "evt_0002", { signal: abort.signal, pollMs: 10 });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };

    await readUntil("evt_0003");
    tracer.emit({ agent: "scout", kind: "output", summary_ar: "تم", summary_en: "Done" });
    await readUntil("evt_0004");
    abort.abort();

    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(text).not.toContain("evt_0002");
    expect(text).toContain('id: evt_0003\ndata: {"id":"evt_0003"');
    expect(text).toMatch(/id: evt_0004\ndata: .*"summary_en":"Done"/);
  });
});
