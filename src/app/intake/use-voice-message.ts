"use client";

// The learner's voice message in the intake (#37). The microphone records in the browser; the
// recording is decoded, mixed down to mono and resampled to 16 kHz in an OfflineAudioContext, encoded
// as WAV and posted to the intake's transcribe route. The transcript goes to `onText`, which puts it
// in the composer: nothing is sent for the learner. In replay, `playRecorded` plays the bundled clip
// aloud and posts the same bytes, which have a recorded transcription.

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, MAX_VOICE_SECONDS, WAV_RATE } from "../../server/agents/intake/wav.ts";

// A recording: idle → asking (the browser asks for the microphone) → recording → transcribing → idle.
// The replay clip: idle → playing → transcribing → idle.
export type VoiceState = "idle" | "asking" | "recording" | "playing" | "transcribing";

const ERROR = {
  denied: "لم يُسمح للصفحة باستعمال الميكروفون. اسمح به من إعدادات المتصفح، أو اكتب رسالتك.",
  unavailable: "لم نصل إلى ميكروفون في هذا الجهاز. اكتب رسالتك.",
  tooLong: "الرسالة الصوتية أطول من دقيقة. سجّل رسالة أقصر.",
  silent: "لم نسمع كلامًا في التسجيل. حاول مرة أخرى، أو اكتب رسالتك.",
  failed: "تعذّر تحويل رسالتك الصوتية إلى نص. حاول مرة أخرى، أو اكتبها.",
};

// Decoding into a 16 kHz context resamples; rendering through a mono one mixes the channels down.
async function toWav(recording: Blob): Promise<Uint8Array<ArrayBuffer> | null> {
  const decoded = await new OfflineAudioContext(1, 1, WAV_RATE).decodeAudioData(
    await recording.arrayBuffer(),
  );
  if (decoded.length === 0) return null;
  const mono = new OfflineAudioContext(1, decoded.length, WAV_RATE);
  const source = mono.createBufferSource();
  source.buffer = decoded;
  source.connect(mono.destination);
  source.start();
  return encodeWav((await mono.startRendering()).getChannelData(0));
}

// Resolves when the clip ends, or at once if the browser will not play it: the transcript still comes.
function play(clip: Blob): Promise<void> {
  const url = URL.createObjectURL(clip);
  const audio = new Audio(url);
  return new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  }).finally(() => URL.revokeObjectURL(url));
}

export function useVoiceMessage({
  sessionId,
  onText,
  onError,
}: {
  sessionId: string;
  onText(text: string): void;
  onError(message: string): void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  // Whole seconds recorded so far.
  const [seconds, setSeconds] = useState(0);
  // The recording in progress: `stop` transcribes it, `drop` discards it.
  const recorder = useRef<{ stop(): void; drop(): void } | null>(null);

  const transcribe = useCallback(
    async (audio: Blob) => {
      setState("transcribing");
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/intake/transcribe`,
          { method: "POST", headers: { "content-type": "audio/wav" }, body: audio },
        );
        if (res.status === 413) return onError(ERROR.tooLong);
        if (!res.ok) return onError(ERROR.failed);
        const { text } = (await res.json()) as { text: string };
        if (text) onText(text);
        else onError(ERROR.silent);
      } catch {
        onError(ERROR.failed);
      } finally {
        setState("idle");
      }
    },
    [sessionId, onText, onError],
  );

  async function record() {
    setState("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      setState("idle");
      const name = e instanceof DOMException ? e.name : "";
      onError(
        name === "NotAllowedError" || name === "SecurityError" ? ERROR.denied : ERROR.unavailable,
      );
      return;
    }
    const media = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    media.ondataavailable = (e) => chunks.push(e.data);
    const end = () => {
      if (media.state === "recording") media.stop();
    };
    // performance.now() measures a duration, not the time of day, so ADR-004's clock rule does not
    // apply. The recorder's own chunks are no clock: Chrome stops handing them over in silence.
    const started = performance.now();
    const tick = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - started) / 1000);
      setSeconds(Math.min(elapsed, MAX_VOICE_SECONDS));
      if (elapsed >= MAX_VOICE_SECONDS) end();
    }, 250);
    const release = () => {
      window.clearInterval(tick);
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
    };
    media.onstop = async () => {
      release();
      setState("transcribing");
      try {
        const wav = await toWav(new Blob(chunks, { type: media.mimeType }));
        if (wav) return await transcribe(new Blob([wav], { type: "audio/wav" }));
        onError(ERROR.silent);
      } catch {
        onError(ERROR.failed);
      }
      setState("idle");
    };
    recorder.current = {
      stop: end,
      drop: () => {
        media.onstop = null;
        end();
        release();
      },
    };
    setSeconds(0);
    media.start();
    setState("recording");
  }

  const stop = () => recorder.current?.stop();

  async function playRecorded(url: string) {
    setState("playing");
    let clip: Blob;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      clip = await res.blob();
    } catch {
      setState("idle");
      onError(ERROR.failed);
      return;
    }
    await play(clip);
    await transcribe(clip);
  }

  // Leaving the page drops a recording in progress and frees the microphone.
  useEffect(() => () => recorder.current?.drop(), []);

  return { state, seconds, record, stop, playRecorded };
}
