import { describe, expect, it } from "vitest";
import type { Quiz, QuizAttempt } from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { AttemptInvalid, type Examiner, QuizConflict, QuizNotFound } from "./examiner.ts";
import { attemptResponse, quizResponse, recapResponse } from "./http.ts";
import type { QuizView } from "./rules.ts";

const seed = loadOmarSeed("Pivot tables");
const QUIZ = seed.quizzes[0] as Quiz;
const ATTEMPT = seed.attempts[0] as QuizAttempt;
const VIEW: QuizView = { quizzes: [QUIZ], attempts: [], mastery: undefined };

// An examiner that records what it was asked and fails as told.
function stubExaminer({ fail, wait }: { fail?: Error; wait?: Promise<void> } = {}) {
  const calls: unknown[][] = [];
  const act = async <T>(call: unknown[], value: T) => {
    calls.push(call);
    await wait;
    if (fail) throw fail;
    return value;
  };
  const examiner: Examiner = {
    view: () => VIEW,
    quiz: (lessonId) => act(["quiz", lessonId], VIEW),
    attempt: (lessonId, quizId, answers) =>
      act(["attempt", lessonId, quizId, answers], { attempt: ATTEMPT, ...VIEW }),
    recap: () => (fail ? undefined : QUIZ),
  };
  return { examiner, calls };
}

let sessions = 0;
const request = (body?: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const ANSWERS = [{ item_id: "i1", response: "تلخيص البيانات بتجميعها" }];

describe("quiz route", () => {
  it("asks for the lesson's quiz and answers it without its keys", async () => {
    const { examiner, calls } = stubExaminer();

    const res = await quizResponse(request({}), `s${++sessions}`, "L1", examiner);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toEqual([["quiz", "L1"]]);
    expect(body.quiz.items.map((i: Record<string, unknown>) => i.prompt_ar)).toEqual(
      QUIZ.items.map((i) => i.prompt_ar),
    );
    expect(JSON.stringify(body)).not.toContain(QUIZ.items[0]?.rubric_ar);
    for (const item of body.quiz.items) expect(item).not.toHaveProperty("answer");
  });

  it("answers 400 for a body with anything in it, 404 for a lesson the plan lacks and 409 before the lesson is written", async () => {
    expect(
      (await quizResponse(request({ fresh: true }), "s", "L1", stubExaminer().examiner)).status,
    ).toBe(400);
    const missing = stubExaminer({ fail: new QuizNotFound("no lesson L9") }).examiner;
    expect((await quizResponse(request({}), "s", "L9", missing)).status).toBe(404);
    const early = await quizResponse(
      request({}),
      "s",
      "L1",
      stubExaminer({ fail: new QuizConflict("not written") }).examiner,
    );
    expect(early.status).toBe(409);
    expect(early.headers.get("retry-after")).toBeNull();
  });

  it("answers 409 with Retry-After while the lesson's quiz is still being written, and 502 when writing fails", async () => {
    let finish = () => {};
    const { examiner } = stubExaminer({ wait: new Promise((resolve) => (finish = resolve)) });

    const first = quizResponse(request({}), "busy", "L1", examiner);
    const second = await quizResponse(request({}), "busy", "L1", examiner);
    finish();

    expect(second.status).toBe(409);
    expect(second.headers.get("retry-after")).toBe("3");
    expect((await first).status).toBe(200);
    const failed = stubExaminer({ fail: new StepFailed("Step quiz:L1 failed") }).examiner;
    expect((await quizResponse(request({}), "s", "L1", failed)).status).toBe(502);
  });
});

describe("attempt route", () => {
  it("passes the answers on and answers the graded attempt", async () => {
    const { examiner, calls } = stubExaminer();

    const res = await attemptResponse(
      request({ quiz_id: "q1", answers: ANSWERS }),
      `s${++sessions}`,
      "L1",
      examiner,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).attempt).toEqual(ATTEMPT);
    expect(calls).toEqual([["attempt", "L1", "q1", ANSWERS]]);
  });

  it.each([
    ["no quiz id", { answers: ANSWERS }],
    ["answers that are not a list", { quiz_id: "q1", answers: "كلها" }],
    [
      "an answer too long to be one",
      { quiz_id: "q1", answers: [{ item_id: "i1", response: "ا".repeat(2001) }] },
    ],
    ["not json", "not json"],
  ])("answers 400 for a body with %s", async (_, body) => {
    const { examiner, calls } = stubExaminer();

    expect((await attemptResponse(request(body), "s", "L1", examiner)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("answers 400 for answers the quiz cannot take, 409 for a quiz no longer the one to take, and 502 when grading fails", async () => {
    const invalid = stubExaminer({ fail: new AttemptInvalid("item i2 has no answer") }).examiner;
    const stale = stubExaminer({
      fail: new QuizConflict("quiz q0 is not the one to take"),
    }).examiner;
    const failed = stubExaminer({ fail: new StepFailed("Step grade failed") }).examiner;
    const body = { quiz_id: "q1", answers: ANSWERS };

    expect((await attemptResponse(request(body), "s", "L1", invalid)).status).toBe(400);
    expect((await attemptResponse(request(body), "s", "L1", stale)).status).toBe(409);
    expect((await attemptResponse(request(body), "s", "L1", failed)).status).toBe(502);
  });
});

describe("recap route", () => {
  it("answers a recap quiz without its keys, and 409 before a lesson is passed", async () => {
    const res = recapResponse(stubExaminer().examiner);
    const none = recapResponse(stubExaminer({ fail: new Error("none") }).examiner);

    expect(res.status).toBe(200);
    for (const item of (await res.json()).quiz.items) expect(item).not.toHaveProperty("answer");
    expect(none.status).toBe(409);
  });

  it("answers 400 for a session id the store refuses", async () => {
    const examiner: Examiner = {
      ...stubExaminer().examiner,
      recap: () => {
        throw new InvalidNameError("Invalid session id: bad.id");
      },
    };

    expect(recapResponse(examiner).status).toBe(400);
  });
});
