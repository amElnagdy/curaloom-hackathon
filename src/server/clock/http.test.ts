import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createFileStore } from "../store/store";
import { simResponse } from "./http";

function setup(enabled = true) {
  const deps = {
    store: createFileStore(mkdtempSync(join(tmpdir(), "sim-http-"))),
    seed: loadOmarSeed("x"),
    enabled,
  };
  const post = (action: string, body?: unknown, sessionId = "s_1") =>
    simResponse(
      new Request("http://localhost/x", {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      sessionId,
      action,
      deps,
    );
  return { post };
}

describe("sim routes", () => {
  it("answer the new time and the coach events each move fired", async () => {
    const { post } = setup();

    const set = await (await post("set", { day: 5 })).json();
    const advance = await (await post("advance", { days: 5, minutes: 30 })).json();
    const reset = await (await post("reset")).json();

    expect(set.now).toBe("day 5 09:00");
    expect(set.events.map((e: { id: string }) => e.id)).toEqual(["c1", "c2"]);
    expect(advance.now).toBe("day 10 09:30");
    expect(advance.events.map((e: { id: string }) => e.id)).toEqual(["c3"]);
    expect(reset).toEqual({ now: "day 0 09:00", events: [] });
  });

  it("refuse a time before now with 409, and a bad body or session id with 400", async () => {
    const { post } = setup();
    await post("set", { day: 10 });

    expect((await post("set", { day: 2 })).status).toBe(409);
    expect((await post("advance", { days: -1 })).status).toBe(400);
    expect((await post("advance", {})).status).toBe(400);
    expect((await post("set", { day: "ten" })).status).toBe(400);
    expect((await post("set", { day: 11 }, "../etc")).status).toBe(400);
  });

  it("answer 404 for an unknown move and while SIM_CLOCK is off", async () => {
    expect((await setup().post("rewind")).status).toBe(404);
    expect((await setup(false).post("set", { day: 2 })).status).toBe(404);
  });
});
