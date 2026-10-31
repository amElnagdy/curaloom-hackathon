// The audio Muse Voice Transcribe takes (docs/spikes/api-access.md): a RIFF WAV file, mono, 16-bit
// PCM, at 16 or 24 kHz. The intake page encodes the learner's voice message this way in the browser
// (#37), and the transcribe route reads the header back before it pays for a call.

export const WAV_RATE = 16_000;
// The page stops recording at a minute. The route's cap holds a minute at WAV_RATE with room to spare.
export const MAX_VOICE_SECONDS = 60;

// Mono samples from -1 to 1, as the Web Audio API gives them, as a 16-bit PCM WAV file.
export function encodeWav(samples: Float32Array, sampleRate = WAV_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, i) => {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  });
  return bytes;
}

// Whether the transcriber takes this file. The header's chunks are walked rather than read at fixed
// offsets: macOS's afconvert, which made the bundled clip, pads the header with a FLLR chunk.
export function transcribableWav(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return false;
  let fmt = false;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag(at) === "fmt ") {
      if (body + 16 > bytes.length) return false;
      fmt =
        view.getUint16(body, true) === 1 &&
        view.getUint16(body + 2, true) === 1 &&
        [16_000, 24_000].includes(view.getUint32(body + 4, true)) &&
        view.getUint16(body + 14, true) === 16;
      if (!fmt) return false;
    }
    if (tag(at) === "data") return fmt && size > 0 && body < bytes.length;
    at = body + size + (size % 2);
  }
  return false;
}
