import { describe, expect, it } from "vitest";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidAnswers } from "./diagnostic.ts";
import { intakeResponse } from "./http.ts";
import { type Intake, IntakeConflict, type IntakeView } from "./intake.ts";

const VIEW: IntakeView = {
  status: "interview",
  turns: [{ role: "interviewer", text_ar: "أهلًا" }],
  heard: {
    goal: null,
    background: null,
    hours_per_week: null,
    source_langs_ok: null,
    history_notes: null,
  },
  dialect: null,
  questions: null,
  picked: null,
  result: null,
};

// An intake that records what it was asked and fails as told.
function stubIntake(fail?: Error, wait?: Promise<void>) {
  const calls: unknown[] = [];
  const act = async (call: unknown) => {
    calls.push(call);
    await wait;
    if (fail) throw fail;
    return VIEW;
  };
  const intake: Intake = {
    view: () => VIEW,
    start: () => VIEW,
    message: (text) => act({ message: text }),
    answer: (picked) => act({ answer: picked }),
    reset: () => calls.push("reset"),
  };
  return { intake, calls };
}

let sessions = 0;
const post = (intake: Intake, action: string, body?: unknown, sessionId = `s${++sessions}`) =>
  intakeResponse(
    new Request("http://localhost/x", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    sessionId,
    action,
    intake,
  );

describe("intake routes", () => {
  it("pass a message or answers on and answer the interview as it now stands", async () => {
    const { intake, calls } = stubIntake();

    const message = await post(intake, "message", { text: "أبي أصير محلل بيانات" });
    const answers = await post(intake, "answers", { answers: { q1: "أ" } });
    const reset = await post(intake, "reset", {});

    expect(message.status).toBe(200);
    expect(await message.json()).toEqual({ view: VIEW });
    expect(answers.status).toBe(200);
    expect(await reset.json()).toEqual({ view: null });
    expect(calls).toEqual([{ message: "أبي أصير محلل بيانات" }, { answer: { q1: "أ" } }, "reset"]);
  });

  it("answer 400 for a body that does not fit the action, and 404 for an unknown action", async () => {
    const { intake, calls } = stubIntake();

    for (const [action, body] of [
      ["message", { text: "   " }],
      ["message", { text: "x", extra: 1 }],
      ["message", "not json"],
      ["answers", { answers: { q1: 3 } }],
      ["start", { text: "x" }],
    ] as const) {
      expect((await post(intake, action, body)).status).toBe(400);
    }
    expect((await post(intake, "skip", {})).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("answer 400 for answers that do not fit the questions, and 409 out of turn", async () => {
    const answers = { answers: { q1: "أ" } };

    const wrong = await post(stubIntake(new InvalidAnswers("q2 needs")).intake, "answers", answers);
    const early = await post(stubIntake(new IntakeConflict("not now")).intake, "answers", answers);

    expect(wrong.status).toBe(400);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "not now" });
  });

  it("answer 409 to a second message while the first one is still being answered", async () => {
    let finish = () => {};
    const { intake } = stubIntake(undefined, new Promise((resolve) => (finish = resolve)));

    const first = post(intake, "message", { text: "أ" }, "busy");
    const second = await post(intake, "message", { text: "ب" }, "busy");
    finish();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    expect((await post(intake, "message", { text: "ج" }, "busy")).status).toBe(200);
  });

  it("answer 502 when the model step fails after its retry", async () => {
    const { intake } = stubIntake(new StepFailed("Step intake failed: timeout"));

    const res = await post(intake, "message", { text: "أ" });

    expect(res.status).toBe(502);
  });
});
