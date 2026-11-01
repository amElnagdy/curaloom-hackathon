import { describe, expect, it } from "vitest";
import { StepFailed } from "../../orchestrator/orchestrator.ts";
import { InvalidNameError } from "../../store/store.ts";
import { InvalidAnswers } from "./diagnostic.ts";
import { intakeResponse, transcribeResponse } from "./http.ts";
import { type Intake, IntakeConflict, type IntakeView } from "./intake.ts";
import { encodeWav, MAX_VOICE_SECONDS, WAV_RATE } from "./wav.ts";

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
  level_note_ar: null,
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
      headers: { "content-type": "application/json" },
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

// A transcriber that records the audio it was given and answers or fails as told.
function stubTranscriber(fail?: Error) {
  const heard: Uint8Array[] = [];
  const transcribe = async (audio: Uint8Array) => {
    heard.push(audio);
    if (fail) throw fail;
    return "أنا محاسب في الرياض";
  };
  return { transcribe, heard };
}

const AUDIO_LIMIT = 2 * 1024 * 1024;
const voice = (seconds: number) => encodeWav(new Float32Array(Math.round(seconds * WAV_RATE)));

const postVoice = (
  transcribe: (audio: Uint8Array) => Promise<string>,
  body: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
) =>
  transcribeResponse(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "audio/wav", ...headers },
      body,
    }),
    transcribe,
  );

describe("intake transcribe route", () => {
  it("passes a voice message on and answers its transcript, a full minute included", async () => {
    const { transcribe, heard } = stubTranscriber();
    const minute = voice(MAX_VOICE_SECONDS);

    const res = await postVoice(transcribe, minute);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "أنا محاسب في الرياض" });
    expect(heard).toHaveLength(1);
    expect(Buffer.from(heard[0] as Uint8Array).equals(minute)).toBe(true);
  });

  it("answers 413 for a content-length over 2 MB without reading the body", async () => {
    const { transcribe, heard } = stubTranscriber();
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "audio/wav", "content-length": String(AUDIO_LIMIT + 1) },
      body: voice(1),
    });

    const res = await transcribeResponse(request, transcribe);

    expect(res.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(heard).toEqual([]);
  });

  it("reads a body sent without a length up to 2 MB, and stops reading it past that with 413", async () => {
    const { transcribe, heard } = stubTranscriber();
    // Node sends a stream body only with `duplex`, which the DOM's RequestInit does not name.
    const send = (body: ReadableStream<Uint8Array>) => {
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body,
        duplex: "half",
      };
      return transcribeResponse(new Request("http://localhost/x", init), transcribe);
    };
    const fits = streamed(voice(MAX_VOICE_SECONDS));
    const over = streamed(voice(AUDIO_LIMIT / WAV_RATE));

    expect((await send(fits.body)).status).toBe(200);
    expect((await send(over.body)).status).toBe(413);
    expect(over.cancelled()).toBe(true);
    expect(heard).toHaveLength(1);
  });

  it("answers 400 for a post from another site, a body not sent as audio/wav, or audio it cannot take", async () => {
    const { transcribe, heard } = stubTranscriber();
    const stereo = voice(1);
    new DataView(stereo.buffer).setUint16(22, 2, true);

    const refused = [
      await postVoice(transcribe, voice(1), { "sec-fetch-site": "cross-site" }),
      await postVoice(transcribe, voice(1), { "content-type": "application/json" }),
      await postVoice(transcribe, voice(1), { "content-type": "audio/webm" }),
      await postVoice(transcribe, stereo),
      await postVoice(transcribe, voice(0)),
    ];

    expect(refused.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(heard).toEqual([]);
  });

  it("answers 409 when the interview is not waiting for a message, 400 for a bad session id, 502 when the transcription fails", async () => {
    const statuses = await Promise.all(
      [
        new IntakeConflict("The interview is not waiting for a message"),
        new InvalidNameError("bad session id"),
        new Error("Meta /asr/transcribe HTTP 500"),
      ].map(async (fail) => (await postVoice(stubTranscriber(fail).transcribe, voice(1))).status),
    );

    expect(statuses).toEqual([409, 400, 502]);
  });
});

// Bytes streamed in 64 KB chunks with no content-length, as a chunked upload arrives.
function streamed(bytes: Uint8Array) {
  let at = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(at, at + 64 * 1024));
      at += 64 * 1024;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, cancelled: () => cancelled };
}
