import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseModels } from "./models";
import { createProvider, type ProviderOptions, type ProviderTraceEvent } from "./provider";

// Real (redacted) Meta responses recorded by spike #7.
const SPIKE = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../docs/spikes/api-access.results.json"), "utf8"),
) as { feature: string; endpoint: string; raw: Record<string, unknown> }[];
const spike = (feature: string, endpoint: string) => {
  const found = SPIKE.find((r) => r.feature === feature && r.endpoint.startsWith(endpoint));
  if (!found) throw new Error(`no spike response for ${feature}`);
  return found.raw;
};

const MODELS = parseModels(`
roles:
  agent_default: {provider: meta, model: muse-spark-1.3, reasoning: low}
  transcribe:    {provider: meta, model: muse-voice-transcribe-1.0}
  segment:       {provider: meta, model: sam-3.1}
  image_edit:    {provider: meta, model: muse-image-1.0}
prices:
  muse-spark-1.3:            {input: 1.25, cached_input: 0.15, output: 4.25}
  muse-voice-transcribe-1.0: {per_audio_hour: 0.18}
  muse-image-1.0:            {per_image: 0.01}
  sam-3.1:                   {per_image: 0.0025}
tool_prices:
  web_search: 0.0025
`);

const TRACE = { agent: "test", summary_ar: "اختبار", summary_en: "Test call" };

type Sent = { url: string; headers: Headers; body: unknown };
type Reply = { status: number; body: unknown } | { sse: unknown[] } | Error;

function fakeFetch(replies: Reply[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body =
      init?.body instanceof FormData
        ? JSON.parse(await (init.body.get("request") as Blob).text())
        : JSON.parse(String(init?.body));
    sent.push({ url: String(url), headers, body });
    const reply = replies.shift();
    if (!reply) throw new Error("fake fetch: no reply left");
    if (reply instanceof Error) throw reply;
    if ("sse" in reply) {
      const text = reply.sse.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(text, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json(reply.body, { status: reply.status });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

function provider(replies: Reply[], options: Partial<ProviderOptions> = {}) {
  const fake = fakeFetch(replies);
  const events: ProviderTraceEvent[] = [];
  const p = createProvider({
    models: MODELS,
    profile: "live",
    apiKey: "sk-test-secret",
    fetch: fake.fetch,
    onTrace: (e) => events.push(e),
    sleep: async () => {},
    ...options,
  });
  return { p, sent: fake.sent, events };
}

describe("Meta provider normalization", () => {
  it("returns parsed JSON for structured output, routed by role", async () => {
    const { p, sent } = provider([{ status: 200, body: spike("json_schema", "/responses") }]);
    const schema = { type: "object", properties: {}, required: [], additionalProperties: false };

    const result = await p.structured({
      role: "agent_default",
      trace: TRACE,
      input: "عندي خمس ساعات",
      schema: { name: "learner_profile", schema },
    });

    expect(result.json).toEqual({
      goal: "تعلم تحليل البيانات",
      hours_per_week: 5,
      level: "beginner",
    });
    expect(result.model).toBe("muse-spark-1.3");
    expect(result.usage).toEqual({ in: 41, out: 817, cost_usd: expect.closeTo(0.0035235, 6) });
    expect(sent[0]?.url).toBe("https://api.meta.ai/v1/responses");
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer sk-test-secret");
    expect(sent[0]?.body).toMatchObject({
      model: "muse-spark-1.3",
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "learner_profile", strict: true, schema } },
    });
  });

  it("normalizes tool calls and ignores commentary messages", async () => {
    const { p } = provider([{ status: 200, body: spike("tool_call", "/responses") }]);

    const result = await p.chat({
      role: "agent_default",
      trace: TRACE,
      input: "ابحث لي عن دورات",
      tools: [{ name: "search_open_courses", description: "d", parameters: { type: "object" } }],
    });

    expect(result.tool_calls).toEqual([
      {
        id: "call_652bb113-cc8c-4b44-86fa-aaac98b6413a",
        name: "search_open_courses",
        args: { language: "en", topic: "data analysis" },
      },
    ]);
    expect(result.text).toBe("");
  });

  it("returns deduplicated citations with the cited text, and bills each search", async () => {
    const { p, sent } = provider([{ status: 200, body: spike("web_search", "/responses") }]);

    const result = await p.webSearch({ role: "agent_default", trace: TRACE, input: "pandas" });

    expect(sent[0]?.body).toMatchObject({ tools: [{ type: "web_search" }] });
    expect(result.text).toMatch(/pandas 3\.1\.0/);
    expect(result.citations.map((c) => c.url)).toEqual([
      "https://pandas.pydata.org/docs/whatsnew/v3.1.0.html",
      "https://github.com/pandas-dev/pandas/releases/tag/v3.1.0",
      "https://pypi.org/project/pandas/",
    ]);
    expect(result.citations[0]).toMatchObject({
      title: "What’s new in 3.1.0 (October 22, 2026) — pandas 3.1.0 documentation",
      snippet: expect.stringContaining("What’s new in 3.1.0"),
    });
    // Spike #7: 50,869 input + 2,072 output tokens ($0.0724) plus 5 billed searches ($0.0125).
    expect(result.usage.cost_usd).toBeCloseTo(0.0849, 4);
  });

  it("transcribes audio as multipart and prices it by duration", async () => {
    const { p, sent } = provider([{ status: 200, body: spike("transcribe", "/asr") }]);

    const result = await p.transcribe({
      role: "transcribe",
      trace: TRACE,
      audio: new Uint8Array([1, 2, 3]),
      keywords: ["بايثون"],
    });

    expect(sent[0]?.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(sent[0]?.body).toMatchObject({
      model: "muse-voice-transcribe-1.0",
      audioEncoding: "WAV",
      languageBias: ["Arabic"],
      keywords: ["بايثون"],
    });
    expect(result.text).toMatch(/^مرحباً، اسمي عمر/);
    expect(result.usage.cost_usd).toBeCloseTo((17.04 / 3600) * 0.18, 8);
  });

  it("reads SAM's streamed answer as raw segmentation text", async () => {
    const events = (spike("segment", "/responses") as { events: unknown[] }).events;
    const { p, sent } = provider([{ sse: events }]);

    const result = await p.segment({
      role: "segment",
      trace: TRACE,
      prompt: "apple",
      image: { b64: "AAAA", mime: "image/webp" },
    });

    expect(sent[0]?.body).toMatchObject({ model: "sam-3.1", stream: true });
    expect(result.text).toMatch(/^<0f>0<\|box;x1=576;y1=287;x2=1339;y2=1041;w=1920;h=1280\|>/);
    expect(result.usage.cost_usd).toBeCloseTo(0.0025, 8);
  });

  it("returns the edited image", async () => {
    const body = { data: [{ b64_json: "UklGRg==" }], output_format: "webp", usage: {} };
    const { p, sent } = provider([{ status: 200, body }]);

    const result = await p.imageEdit({
      role: "image_edit",
      trace: TRACE,
      prompt: "replace the labels with Arabic",
      images: [{ b64: "AAAA", mime: "image/png" }],
    });

    expect(sent[0]?.url).toBe("https://api.meta.ai/v1/images/edits");
    expect(sent[0]?.body).toMatchObject({ images: [{ image_url: "data:image/png;base64,AAAA" }] });
    expect(result.image).toEqual({ b64: "UklGRg==", format: "webp" });
    expect(result.usage.cost_usd).toBeCloseTo(0.01, 8);
  });

  it("rejects an unknown role", async () => {
    const { p } = provider([]);

    await expect(p.chat({ role: "nope", trace: TRACE, input: "x" })).rejects.toThrow(/role "nope"/);
  });
});

describe("retries, cost and trace", () => {
  const ok = { status: 200, body: spike("json_schema", "/responses") };
  const schema = { name: "s", schema: { type: "object" } };

  it("retries 429 and 5xx with backoff and traces every attempt", async () => {
    const sleeps: number[] = [];
    const { p, events } = provider(
      [{ status: 429, body: { error: "slow down" } }, { status: 503, body: {} }, ok],
      { sleep: async (ms) => void sleeps.push(ms) },
    );

    await p.structured({ role: "agent_default", trace: TRACE, input: "x", schema });

    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0] ?? 0);
    expect(events.map((e) => [e.attempt, e.ok])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(events[2]).toMatchObject({
      kind: "model_call",
      agent: "test",
      role: "agent_default",
      model: "muse-spark-1.3",
      summary_ar: "اختبار",
      summary_en: "Test call",
      cost_usd: expect.any(Number),
    });
  });

  it("does not retry a 400", async () => {
    const { p, sent } = provider([{ status: 400, body: { error: { message: "bad schema" } } }]);

    await expect(
      p.structured({ role: "agent_default", trace: TRACE, input: "x", schema }),
    ).rejects.toThrow(/HTTP 400.*bad schema/);
    expect(sent).toHaveLength(1);
  });

  it("counts the cost of structured output that is not JSON, without retrying", async () => {
    const body = structuredClone(spike("json_schema", "/responses")) as {
      output: { type: string; content?: { text: string }[] }[];
    };
    const message = body.output.find((o) => o.type === "message");
    if (message?.content?.[0]) message.content[0].text = "not json";
    const { p, sent, events } = provider([{ status: 200, body }]);

    await expect(
      p.structured({ role: "agent_default", trace: TRACE, input: "x", schema }),
    ).rejects.toThrow(/not valid JSON/);
    expect(sent).toHaveLength(1);
    expect(events).toMatchObject([{ ok: false, cost_usd: expect.closeTo(0.0035235, 6) }]);
    expect(p.totalCostUsd()).toBeCloseTo(0.0035235, 6);
  });

  it("gives up after three failed attempts", async () => {
    const { p, sent } = provider([
      new Error("network"),
      new Error("network"),
      new Error("network"),
    ]);

    await expect(p.chat({ role: "agent_default", trace: TRACE, input: "x" })).rejects.toThrow(
      /network/,
    );
    expect(sent).toHaveLength(3);
  });

  it("traces how long a failed attempt took", async () => {
    let calls = 0;
    const slowThenOk = (async () => {
      calls++;
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 30));
        return Response.json({}, { status: 503 });
      }
      return Response.json(ok.body);
    }) as typeof globalThis.fetch;
    const { p, events } = provider([], { fetch: slowThenOk });

    await p.structured({ role: "agent_default", trace: TRACE, input: "x", schema });

    expect(events[0]).toMatchObject({ ok: false });
    expect(events[0]?.latency_ms).toBeGreaterThanOrEqual(25);
  });

  it("keeps a running cost total across calls and in each trace event", async () => {
    const { p, events } = provider([ok, ok]);

    await p.structured({ role: "agent_default", trace: TRACE, input: "x", schema });
    await p.structured({ role: "agent_default", trace: TRACE, input: "x", schema });

    expect(p.totalCostUsd()).toBeCloseTo(2 * 0.0035235, 6);
    expect(events.at(-1)?.total_cost_usd).toBeCloseTo(2 * 0.0035235, 6);
  });

  it("never puts the API key in a trace event or error", async () => {
    const { p, events } = provider([{ status: 401, body: { error: "bad key" } }]);

    const error = await p.chat({ role: "agent_default", trace: TRACE, input: "x" }).catch((e) => e);

    expect(JSON.stringify(events)).not.toContain("sk-test-secret");
    expect(String(error)).not.toContain("sk-test-secret");
  });
});

describe("record and replay", () => {
  const schema = { name: "s", schema: { type: "object" } };
  const call = { role: "agent_default", trace: TRACE, input: "x", schema };

  it("replays a recorded response with no network and no key", async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), "fixtures-"));
    const { p: recorder } = provider([{ status: 200, body: spike("json_schema", "/responses") }], {
      profile: "record",
      fixturesDir,
    });
    const recorded = await recorder.structured(call);

    const replayer = createProvider({ models: MODELS, profile: "replay", fixturesDir });
    const replayed = await replayer.structured(call);

    expect(readdirSync(fixturesDir)).toHaveLength(1);
    expect(replayed).toEqual(recorded);
    expect(
      readFileSync(join(fixturesDir, readdirSync(fixturesDir)[0] ?? ""), "utf8"),
    ).not.toContain("sk-test-secret");
  });

  it("records only a request it has no recording for, so a re-record pays for what changed", async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), "fixtures-"));
    const first = provider([{ status: 200, body: spike("json_schema", "/responses") }], {
      profile: "record",
      fixturesDir,
    });
    const recorded = await first.p.structured(call);
    const saved = readFileSync(join(fixturesDir, readdirSync(fixturesDir)[0] ?? ""), "utf8");

    const again = provider([], { profile: "record", fixturesDir });
    const reused = await again.p.structured(call);

    expect(again.sent).toEqual([]);
    expect(reused.json).toEqual(recorded.json);
    expect(readFileSync(join(fixturesDir, readdirSync(fixturesDir)[0] ?? ""), "utf8")).toBe(saved);
  });

  it("fails clearly when replay has no recording for a request", async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), "fixtures-"));
    const replayer = createProvider({ models: MODELS, profile: "replay", fixturesDir });

    await expect(replayer.structured(call)).rejects.toThrow(/no recorded response.*record/i);
  });

  it("needs a key outside replay", async () => {
    const p = createProvider({ models: MODELS, profile: "live" });

    await expect(p.chat({ role: "agent_default", trace: TRACE, input: "x" })).rejects.toThrow(
      /MODEL_API_KEY/,
    );
  });
});
