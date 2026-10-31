import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../demo/seed";
import { sessionSim } from "../coach/session";
import { createFileStore } from "../store/store";
import { consentResponse, inboxResponse, simResponse } from "./http";

const JSON_TYPE = { "content-type": "application/json" };

function setup(enabled = true) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "sim-http-")));
  const seed = loadOmarSeed("x");
  const deps = { sim: (sessionId: string) => sessionSim(store, sessionId, seed).sim, enabled };
  const post = (action: string, body?: unknown, sessionId = "s_1") =>
    simResponse(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      sessionId,
      action,
      deps,
    );
  const reply = (body: unknown) =>
    inboxResponse(
      new Request("http://localhost/x", {
        method: "POST",
        headers: JSON_TYPE,
        body: JSON.stringify(body),
      }),
      "s_1",
      deps,
    );
  const consent = (body: unknown) =>
    consentResponse(
      new Request("http://localhost/x", {
        method: "POST",
        headers: JSON_TYPE,
        body: JSON.stringify(body),
      }),
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
    expect(set.events.map((e: { id: string }) => e.id)).toEqual(["nudge_a0_d2", "replan_a0_d5"]);
    expect(advance.now).toBe("day 10 09:30");
    expect(advance.events.map((e: { id: string }) => e.id)).toEqual(["checkin_a0_d10"]);
    expect(reset).toEqual({ now: "day 0 09:00", events: [] });
  });

  it("fire each message once when two moves of the same session arrive together", async () => {
    const { post } = setup();

    const answers = await Promise.all([post("set", { day: 10 }), post("set", { day: 10 })]);
    const fired = (await Promise.all(answers.map((res) => res.json()))).flatMap(
      (body: { events: { id: string }[] }) => body.events.map((e) => e.id),
    );

    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    expect(fired).toEqual(["nudge_a0_d2", "replan_a0_d5", "checkin_a0_d10"]);
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

    expect(stop).toEqual({ opted_out: true, confirmed: true, answer: null });
    expect(again).toEqual({ opted_out: true, confirmed: false, answer: null });
    expect((await reply({ text: "   " })).status).toBe(400);
    expect((await reply({})).status).toBe(400);
  });

  it("take a tap on the check-in's button, a pause lasting a week when the body names no days", async () => {
    const { post, reply } = setup();
    await post("set", { day: 10 });
    await post("advance", { minutes: 180 });

    const res = await reply({ event_id: "checkin_a0_d10", choice: "pause" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      opted_out: false,
      confirmed: false,
      answer: { choice: "pause", paused_until: "day 17 09:00" },
    });
  });

  it("answer 400 for a bad tap, and 409 for a message the learner cannot answer", async () => {
    const { post, reply } = setup();
    await post("set", { day: 10 });
    await post("advance", { minutes: 180 });
    const tap = { event_id: "checkin_a0_d10", choice: "pause" };

    const bad = await Promise.all(
      [
        { ...tap, pause_days: 0 },
        { ...tap, pause_days: 31 },
        { ...tap, choice: "quit" },
        { ...tap, extra: 1 },
        { ...tap, text: "استراحة" },
      ].map(reply),
    );
    const unknown = await reply({ ...tap, event_id: "nope" });
    const first = await reply(tap);
    const second = await reply({ ...tap, choice: "switch" });

    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400, 400]);
    expect(unknown.status).toBe(409);
    expect((await unknown.json()).error).toMatch(/nope/);
    expect([first.status, second.status]).toEqual([200, 409]);
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
      new Request("http://localhost/x", {
        method: "POST",
        headers: JSON_TYPE,
        body: JSON.stringify(body),
      }),
      "../x",
      deps,
    );

    expect(badId.status).toBe(400);
    expect((await consent(body)).status).toBe(400);
  });

  it("refuse a request from another site, or a body not sent as JSON", async () => {
    const { deps } = setup();
    const move = (headers: Record<string, string>) =>
      simResponse(
        new Request("http://localhost/x", {
          method: "POST",
          headers,
          body: JSON.stringify({ day: 2 }),
        }),
        "s_1",
        "set",
        deps,
      );

    expect((await move({ "content-type": "text/plain" })).status).toBe(400);
    expect((await move({})).status).toBe(400);
    expect(
      (await move({ "content-type": "application/json", "sec-fetch-site": "cross-site" })).status,
    ).toBe(400);
    expect(
      (await move({ "content-type": "application/json", "sec-fetch-site": "same-origin" })).status,
    ).toBe(200);
  });

  it("answer 413 for a content-length over 128 KB without reading the body", async () => {
    const { deps } = setup();
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { ...JSON_TYPE, "content-length": String(LIMIT + 1) },
      body: JSON.stringify({ day: 2 }),
    });

    const res = await simResponse(request, "s_1", "set", deps);

    expect(res.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it("read a body sent without a length up to 128 KB, and stop reading it past that with 413", async () => {
    const { deps } = setup();
    // Node sends a stream body only with `duplex`, which the DOM's RequestInit does not name.
    const move = (body: ReadableStream<Uint8Array>) => {
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        headers: JSON_TYPE,
        body,
        duplex: "half",
      };
      return simResponse(new Request("http://localhost/x", init), "s_1", "set", deps);
    };
    const fits = streamed(JSON.stringify({ day: 2 }).padEnd(LIMIT));
    const over = streamed(JSON.stringify({ day: 3 }).padEnd(4 * LIMIT));

    expect((await move(fits.body)).status).toBe(200);
    expect((await move(over.body)).status).toBe(413);
    expect(over.cancelled()).toBe(true);
  });
});

const LIMIT = 128 * 1024;

// A body streamed in 16 KB chunks with no content-length, as a chunked upload arrives.
function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(at, at + 16 * 1024));
      at += 16 * 1024;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, cancelled: () => cancelled };
}
