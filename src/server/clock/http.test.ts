import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { createFileStore } from "../store/store";
import { consentResponse, inboxResponse, simResponse } from "./http";

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
  const reply = (body: unknown) =>
    inboxResponse(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }),
      "s_1",
      deps,
    );
  const consent = (body: unknown) =>
    consentResponse(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }),
      "s_1",
      deps,
    );
  return { deps, post, reply, consent };
}

describe("sim and inbox routes", () => {
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

  it("take the learner's reply: a stop word opts out once, a blank reply is a 400", async () => {
    const { reply } = setup();

    const stop = await (await reply({ text: "توقف" })).json();
    const again = await (await reply({ text: "STOP" })).json();

    expect(stop).toEqual({ opted_out: true, confirmed: true });
    expect(again).toEqual({ opted_out: true, confirmed: false });
    expect((await reply({ text: "   " })).status).toBe(400);
    expect((await reply({})).status).toBe(400);
  });

  it("answer 404 for an unknown move and while SIM_CLOCK is off", async () => {
    expect((await setup().post("rewind")).status).toBe(404);
    expect((await setup(false).post("set", { day: 2 })).status).toBe(404);
  });

  it("saves the consent screen's choices at the sim time, and answers 400 for a bad body", async () => {
    const { post, consent } = setup();
    await post("set", { day: 3 });

    const off = await consent({
      messages: false,
      quiet_hours: { start: "21:00", end: "07:00" },
      intensity: "normal",
    });
    const bad = await consent({ messages: "yes", quiet_hours: null, intensity: "normal" });
    const badTime = await consent({
      messages: true,
      quiet_hours: { start: "9pm", end: "07:00" },
      intensity: "normal",
    });

    expect(off.status).toBe(200);
    expect((await off.json()).consent).toMatchObject({
      opted_out: true,
      opted_out_sim_day: 3,
      quiet_hours: { start: "21:00", end: "07:00" },
      intensity: "normal",
    });
    expect(bad.status).toBe(400);
    expect(badTime.status).toBe(400);
  });

  it("answer 400 for a bad session id and for quiet hours that start when they end", async () => {
    const { deps, consent } = setup();
    const body = {
      messages: true,
      quiet_hours: { start: "22:00", end: "22:00" },
      intensity: "gentle",
    };

    const badId = await consentResponse(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }),
      "../x",
      deps,
    );

    expect(badId.status).toBe(400);
    expect((await consent(body)).status).toBe(400);
  });
});
