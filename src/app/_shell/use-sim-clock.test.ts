import { afterEach, describe, expect, it, vi } from "vitest";
import { readWaitsForPlan } from "./use-sim-clock.ts";

const answers = (kind: string) => vi.fn(async () => Response.json({ kind }));

describe("readWaitsForPlan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("holds the clock only between the intake and the learner's plan", async () => {
    vi.stubGlobal("fetch", answers("sample"));
    expect(await readWaitsForPlan("demo")).toBe(false);

    vi.stubGlobal("fetch", answers("none"));
    expect(await readWaitsForPlan("demo")).toBe(true);

    vi.stubGlobal("fetch", answers("own"));
    expect(await readWaitsForPlan("demo")).toBe(false);
  });

  it("reads the session's plan route", async () => {
    const fetch = answers("own");
    vi.stubGlobal("fetch", fetch);

    await readWaitsForPlan("s 1");

    expect(fetch).toHaveBeenCalledWith("/api/sessions/s%201/plan", expect.anything());
  });

  it("never holds the clock on a read that failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Internal Server Error", { status: 500 })),
    );
    expect(await readWaitsForPlan("demo")).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await readWaitsForPlan("demo")).toBe(false);
  });
});
