import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { PlanConflict, PlanEditRejected, type Planner, type SavedPlan } from "./architect.ts";
import { planResponse } from "./http.ts";

const seed = loadOmarSeed("Pivot tables");
const SAVED: SavedPlan = {
  for_profile: "f00d",
  versions: seed.plans,
  resources: seed.resources,
  limits: { budget_minutes: 300, resource_ids: ["r1"] },
};
const BROKEN = { en: "session s1 is on day 9, outside its module's days 0 to 6", ar: "خارج" };

// A planner that records what it was asked and fails as told.
function stubPlanner(fail?: Error, wait?: Promise<void>) {
  const calls: unknown[] = [];
  const act = (call: unknown) => {
    calls.push(call);
    if (fail) throw fail;
    return SAVED;
  };
  const planner: Planner = {
    build: async () => {
      calls.push("build");
      await wait;
      if (fail) throw fail;
      return SAVED;
    },
    edit: (edit) => act(edit),
    reset: () => calls.push("reset"),
  };
  return { planner, calls };
}

let sessions = 0;
const post = (planner: Planner, action: string, body?: unknown, sessionId = `s${++sessions}`) =>
  planResponse(
    new Request("http://localhost/x", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    sessionId,
    action,
    planner,
  );

describe("plan routes", () => {
  it("pass a build or an edit on and answer the saved plan", async () => {
    const { planner, calls } = stubPlanner();

    const build = await post(planner, "build", {});
    const move = await post(planner, "edit", { op: "move", session_id: "s2", day: 6 });
    const shorten = await post(planner, "edit", { op: "shorten", session_id: "s1", minutes: 20 });
    const reset = await post(planner, "reset", {});

    expect(build.status).toBe(200);
    expect(await build.json()).toEqual({ plan: SAVED });
    expect([move.status, shorten.status]).toEqual([200, 200]);
    expect(await reset.json()).toEqual({ plan: null });
    expect(calls).toEqual([
      "build",
      { op: "move", session_id: "s2", day: 6 },
      { op: "shorten", session_id: "s1", minutes: 20 },
      "reset",
    ]);
  });

  it("answer 400 for a body that does not fit the action, and 404 for an unknown action", async () => {
    const { planner, calls } = stubPlanner();

    for (const [action, body] of [
      ["edit", { op: "stretch", session_id: "s1", minutes: 20 }],
      ["edit", { op: "move", session_id: "s1", day: "3" }],
      ["edit", { op: "move", session_id: "s1", day: 1.5 }],
      ["edit", { op: "shorten", session_id: "s1", day: 2 }],
      ["edit", { op: "move", day: 2 }],
      ["edit", "not json"],
      ["build", { force: true }],
    ] as const) {
      expect((await post(planner, action, body)).status).toBe(400);
    }
    expect((await post(planner, "replan", {})).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("answer 400 with the broken rules for an edit the plan cannot take, and 409 before there is a plan", async () => {
    const edit = { op: "move", session_id: "s1", day: 9 };

    const broken = await post(stubPlanner(new PlanEditRejected([BROKEN])).planner, "edit", edit);
    const early = await post(stubPlanner(new PlanConflict("no plan yet")).planner, "edit", edit);

    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: expect.any(String), violations: [BROKEN] });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "no plan yet" });
  });

  it("answer 409 to a call while the session's plan is still being built", async () => {
    let finish = () => {};
    const { planner } = stubPlanner(undefined, new Promise((resolve) => (finish = resolve)));

    const first = post(planner, "build", {}, "busy");
    const second = await post(planner, "edit", { op: "move", session_id: "s1", day: 2 }, "busy");
    finish();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    expect((await post(planner, "build", {}, "busy")).status).toBe(200);
  });

  it("answer 502 when the scout or the architect fails after its retry", async () => {
    const { planner } = stubPlanner(new StepFailed("Step architect failed: timeout"));

    expect((await post(planner, "build", {})).status).toBe(502);
  });
});
