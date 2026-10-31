import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { lessonResponse } from "./http.ts";
import {
  type LessonBuilder,
  LessonConflict,
  LessonLocked,
  LessonNotFound,
  type SavedLessons,
} from "./lesson.ts";

const seed = loadOmarSeed("Pivot tables");
const SAVED: SavedLessons = {
  for_plan: "plan_1",
  lessons: Object.fromEntries(seed.lessons.map((l) => [l.id, l])),
  glossary: seed.glossary,
};

// A lesson builder that records which lessons it was asked for and fails as told.
function stubBuilder(fail?: Error, wait?: Promise<void>) {
  const calls: string[] = [];
  const builder: LessonBuilder = {
    build: async (lessonId) => {
      calls.push(lessonId);
      await wait;
      if (fail) throw fail;
      return SAVED;
    },
  };
  return { builder, calls };
}

let sessions = 0;
const post = (
  builder: LessonBuilder,
  lessonId: string,
  body?: unknown,
  sessionId = `s${++sessions}`,
) =>
  lessonResponse(
    new Request("http://localhost/x", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    sessionId,
    lessonId,
    builder,
  );

describe("lesson route", () => {
  it("passes the lesson on to be built and answers the session's lessons", async () => {
    const { builder, calls } = stubBuilder();

    const res = await post(builder, "L1", {});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lessons: SAVED });
    expect(calls).toEqual(["L1"]);
  });

  it("answers 400 for a body with anything in it", async () => {
    const { builder, calls } = stubBuilder();

    expect((await post(builder, "L1", { force: true })).status).toBe(400);
    expect((await post(builder, "L1", "not json")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("answers 404 for a lesson the plan lacks, and 409 before there is a plan or while the lesson is locked", async () => {
    const missing = await post(stubBuilder(new LessonNotFound("no lesson L9")).builder, "L9", {});
    const early = await post(stubBuilder(new LessonConflict("no plan yet")).builder, "L1", {});
    const locked = await post(stubBuilder(new LessonLocked("L2 is locked")).builder, "L2", {});

    expect(missing.status).toBe(404);
    expect(early.status).toBe(409);
    expect(early.headers.get("retry-after")).toBeNull();
    expect(await early.json()).toEqual({ error: "no plan yet" });
    expect(locked.status).toBe(409);
    expect(locked.headers.get("retry-after")).toBeNull();
  });

  // Retry-After tells the page to ask again; a 409 without it will not clear by waiting.
  it("answers 409 with Retry-After to a second call while the session's lesson is still being written", async () => {
    let finish = () => {};
    const { builder } = stubBuilder(undefined, new Promise((resolve) => (finish = resolve)));

    const first = post(builder, "L1", {}, "busy");
    const second = await post(builder, "L2", {}, "busy");
    finish();

    expect(second.status).toBe(409);
    expect(second.headers.get("retry-after")).toBe("3");
    expect((await first).status).toBe(200);
    expect((await post(builder, "L2", {}, "busy")).status).toBe(200);
  });

  it("answers 502 when the lesson builder fails after its retry", async () => {
    const { builder } = stubBuilder(new StepFailed("Step lesson:L1 failed: timeout"));

    expect((await post(builder, "L1", {})).status).toBe(502);
  });
});
