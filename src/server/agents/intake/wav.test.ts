import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTAKE_VOICE_CLIP } from "../../../../demo/script.ts";
import { encodeWav, transcribableWav, WAV_RATE } from "./wav.ts";

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

// A WAV header as the transcriber reads it, with the fields a test changes.
function wav({
  format = 1,
  channels = 1,
  rate = WAV_RATE,
  bits = 16,
  data = 32,
}: Partial<Record<"format" | "channels" | "rate" | "bits" | "data", number>> = {}) {
  const bytes = encodeWav(new Float32Array(data / 2), WAV_RATE);
  const view = new DataView(bytes.buffer);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint16(34, bits, true);
  return bytes;
}

describe("the voice message's WAV file", () => {
  it("is a RIFF WAV header for mono 16-bit PCM at 16 kHz, then the samples", () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 0.5]));
    const view = new DataView(bytes.buffer);

    expect(bytes.length).toBe(44 + 4 * 2);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(ascii(bytes, 8, 16)).toBe("WAVEfmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(16_000 * 2); // bytes per second
    expect(view.getUint16(32, true)).toBe(2); // bytes per frame
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 40)).toBe("data");
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 16384,
    ]);
  });

  it("clips samples outside -1 to 1 instead of wrapping them", () => {
    const view = new DataView(encodeWav(new Float32Array([1.5, -3])).buffer);

    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([32767, -32768]);
  });

  it("is one the transcriber takes, as is the bundled clip with its padding chunk", () => {
    const clip = readFileSync(join(process.cwd(), "public", INTAKE_VOICE_CLIP));

    expect(transcribableWav(encodeWav(new Float32Array(160)))).toBe(true);
    expect(transcribableWav(wav({ rate: 24_000 }))).toBe(true);
    expect(transcribableWav(new Uint8Array(clip))).toBe(true);
  });

  it("is refused in any other shape: stereo, 8-bit, 44.1 kHz, not PCM, no samples, not RIFF", () => {
    for (const bytes of [
      wav({ channels: 2 }),
      wav({ bits: 8 }),
      wav({ rate: 44_100 }),
      wav({ format: 3 }),
      wav({ data: 0 }),
      new TextEncoder().encode("ID3 not a wav file at all, but long enough to read"),
      new Uint8Array(),
      wav().subarray(0, 30),
    ]) {
      expect(transcribableWav(bytes)).toBe(false);
    }
  });
});
