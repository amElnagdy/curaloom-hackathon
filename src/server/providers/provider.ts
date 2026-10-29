// The provider layer (ADR-002): every model call in the app goes through createProvider().
// It routes by role, owns retries, timeouts and cost, records/replays fixtures,
// and emits one trace event per attempt.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Static, TSchema } from "typebox";
import type { ProviderProfile } from "../../config.ts";
import {
  type Citation,
  completedFromStream,
  type FunctionTool,
  functionTools,
  type ImageInput,
  imageEditRequest,
  META_BASE_URL,
  type Normalized,
  normalizeImages,
  normalizeResponses,
  normalizeTranscribe,
  type ResponseFormat,
  responsesRequest,
  segmentRequest,
  type ToolCall,
  transcribeRequest,
  type WireRequest,
} from "./meta.ts";
import { costUsd, type Models, type RoleConfig } from "./models.ts";

export type { Citation, FunctionTool, ImageInput, ResponseFormat, ToolCall };

export type ModelResult<J = unknown> = {
  text: string;
  json: J;
  tool_calls: ToolCall[];
  citations: Citation[];
  image: { b64: string; format: string } | null;
  usage: { in: number; out: number; cost_usd: number };
  latency_ms: number;
  model: string;
};

// What the caller says about a call, for the trace panel.
export type TraceContext = { agent: string; summary_ar: string; summary_en: string };

export type ProviderTraceEvent = TraceContext & {
  kind: "model_call";
  role: string;
  model: string;
  profile: ProviderProfile;
  attempt: number;
  ok: boolean;
  latency_ms: number;
  usage?: { in: number; out: number };
  cost_usd: number;
  total_cost_usd: number;
  error?: string;
};

type CallBase = { role: string; trace: TraceContext };
type TextInput = CallBase & { instructions?: string; input: string | unknown[] };

export type Provider = {
  chat(call: TextInput & { tools?: FunctionTool[] }): Promise<ModelResult<null>>;
  // Pass a contract (ADR-006) and `json` is typed as it; a plain JSON Schema gives `unknown`.
  structured<S extends object>(
    call: TextInput & { schema: ResponseFormat<S> },
  ): Promise<ModelResult<S extends TSchema ? Static<S> : unknown>>;
  webSearch(call: TextInput): Promise<ModelResult<null>>;
  transcribe(
    call: CallBase & { audio: Uint8Array; keywords?: string[] },
  ): Promise<ModelResult<null>>;
  imageEdit(call: CallBase & { prompt: string; images: ImageInput[] }): Promise<ModelResult<null>>;
  segment(call: CallBase & { prompt: string; image: ImageInput }): Promise<ModelResult<null>>;
  totalCostUsd(): number;
};

export type ProviderOptions = {
  models: Models;
  profile: ProviderProfile;
  apiKey?: string;
  fixturesDir?: string;
  onTrace?: (event: ProviderTraceEvent) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export const FIXTURES_DIR = join(process.cwd(), "demo/fixtures/responses");
const MAX_ATTEMPTS = 3;

type WireResponse = { status: number; body: unknown; latency_ms: number; retryAfterMs?: number };
type Fixture = { request: unknown; body: unknown; latency_ms: number };

class HttpError extends Error {
  retryable: boolean;
  retryAfterMs?: number;

  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function fixtureKey(req: WireRequest): { material: unknown; name: string } {
  const material = req.form
    ? {
        path: req.path,
        request: req.form.request,
        audio_sha256: createHash("sha256").update(req.form.audio).digest("hex"),
      }
    : { path: req.path, json: req.json };
  const hash = createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
  const model = String((req.json ?? req.form?.request)?.model ?? "unknown");
  return { material, name: `${req.path.replace(/\W+/g, "_").slice(1)}-${model}-${hash}.json` };
}

export function createProvider(options: ProviderOptions): Provider {
  const { models, profile } = options;
  const fixturesDir = options.fixturesDir ?? FIXTURES_DIR;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? 120_000;
  let totalCost = 0;

  async function sendLive(req: WireRequest): Promise<WireResponse> {
    if (!options.apiKey) {
      throw new Error("MODEL_API_KEY is not set; copy config/.env.example to .env");
    }
    let body: BodyInit;
    if (req.form) {
      const form = new FormData();
      form.append(
        "request",
        new Blob([JSON.stringify(req.form.request)], { type: "application/json" }),
      );
      form.append(
        "audio",
        new Blob([new Uint8Array(req.form.audio)], { type: req.form.mime }),
        "audio.wav",
      );
      body = form;
    } else {
      body = JSON.stringify(req.json);
    }
    const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}` };
    if (!req.form) headers["content-type"] = "application/json";
    if (req.stream) headers.accept = "text/event-stream";

    const started = performance.now();
    const res = await doFetch(`${META_BASE_URL}${req.path}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Errors come back as plain JSON even when a stream was requested.
    const isStream = res.headers.get("content-type")?.startsWith("text/event-stream");
    const parsed = isStream ? completedFromStream(await res.text()) : await res.json();
    const retryAfter = Number(res.headers.get("retry-after"));
    return {
      status: res.status,
      body: parsed,
      latency_ms: Math.round(performance.now() - started),
      retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : undefined,
    };
  }

  async function send(req: WireRequest): Promise<WireResponse> {
    const { material, name } = fixtureKey(req);
    const path = join(fixturesDir, name);
    const recorded = existsSync(path);
    // Recording reuses what is already recorded, so a re-record calls the model only for the
    // requests that changed. Delete a fixture to record it again.
    if (profile === "replay" || (profile === "record" && recorded)) {
      if (!recorded) {
        throw new Error(
          `No recorded response for ${req.path} (${name}); run once with PROVIDER_PROFILE=record`,
        );
      }
      const fixture = JSON.parse(readFileSync(path, "utf8")) as Fixture;
      return { status: 200, body: fixture.body, latency_ms: fixture.latency_ms };
    }
    const res = await sendLive(req);
    if (profile === "record" && res.status < 300) {
      mkdirSync(fixturesDir, { recursive: true });
      const fixture: Fixture = { request: material, body: res.body, latency_ms: res.latency_ms };
      writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
    }
    return res;
  }

  // Sends with retries: network errors, timeouts, 429 and 5xx are retried with backoff.
  async function sendWithRetry(
    req: WireRequest,
    onFailure: (attempt: number, error: string, latencyMs: number) => void,
  ) {
    for (let attempt = 1; ; attempt++) {
      let error: HttpError;
      // performance.now() measures a duration, not the time of day, so ADR-004's clock rule
      // does not apply.
      const started = performance.now();
      try {
        const res = await send(req);
        if (res.status < 300) return { res, attempt };
        const detail = JSON.stringify(res.body).slice(0, 300);
        error = new HttpError(
          `Meta ${req.path} HTTP ${res.status}: ${detail}`,
          res.status === 429 || res.status >= 500,
          res.retryAfterMs,
        );
      } catch (e) {
        error = new HttpError(e instanceof Error ? e.message : String(e), profile !== "replay");
      }
      onFailure(attempt, error.message, Math.round(performance.now() - started));
      if (!error.retryable || attempt === MAX_ATTEMPTS) throw error;
      const backoff = 500 * 2 ** (attempt - 1) + Math.random() * 250;
      await sleep(Math.max(backoff, error.retryAfterMs ?? 0));
    }
  }

  async function call<J>(
    base: CallBase,
    build: (role: RoleConfig) => WireRequest,
    normalize: (body: unknown) => Normalized,
    parseJson = false,
  ): Promise<ModelResult<J>> {
    const role = models.roles[base.role];
    if (!role) throw new Error(`Unknown model role "${base.role}"; add it to config/models.yaml`);
    type Outcome = Pick<ProviderTraceEvent, "attempt" | "ok" | "latency_ms" | "cost_usd"> &
      Partial<Pick<ProviderTraceEvent, "usage" | "error">>;
    const trace = (outcome: Outcome) =>
      options.onTrace?.({
        kind: "model_call",
        ...base.trace,
        role: base.role,
        model: role.model,
        profile,
        total_cost_usd: totalCost,
        ...outcome,
      });

    const { res, attempt } = await sendWithRetry(build(role), (attempt, error, latency_ms) =>
      trace({ attempt, ok: false, latency_ms, cost_usd: 0, error }),
    );
    const normalized = normalize(res.body);
    const cost = costUsd(models, role.model, normalized.usage);
    totalCost += cost;
    const usage = { in: normalized.usage.input ?? 0, out: normalized.usage.output ?? 0 };
    const outcome = { attempt, latency_ms: res.latency_ms, usage, cost_usd: cost };

    if (normalized.incomplete) {
      const cap = role.max_output_tokens ? `; the role caps it at ${role.max_output_tokens}` : "";
      const error = `reply from ${role.model} was cut off (${normalized.incomplete}) after ${usage.out} output tokens${cap}`;
      trace({ ...outcome, ok: false, error });
      throw new Error(error);
    }
    let json: unknown = null;
    if (parseJson) {
      try {
        json = JSON.parse(normalized.text);
      } catch {
        // Not retried here: the orchestrator's guardrail decides (#13).
        const error = `structured output from ${role.model} is not valid JSON`;
        trace({ ...outcome, ok: false, error });
        throw new Error(error);
      }
    }
    trace({ ...outcome, ok: true });
    return {
      text: normalized.text,
      json: json as J,
      tool_calls: normalized.tool_calls,
      citations: normalized.citations,
      image: normalized.image,
      usage: { ...usage, cost_usd: cost },
      latency_ms: res.latency_ms,
      model: role.model,
    };
  }

  const responsesCall =
    (c: TextInput, tools?: unknown[], format?: ResponseFormat) => (role: RoleConfig) =>
      responsesRequest(role, { instructions: c.instructions, input: c.input, tools, format });

  return {
    chat: (c) => call(c, responsesCall(c, c.tools && functionTools(c.tools)), normalizeResponses),
    structured: (c) => call(c, responsesCall(c, undefined, c.schema), normalizeResponses, true),
    webSearch: (c) => call(c, responsesCall(c, [{ type: "web_search" }]), normalizeResponses),
    transcribe: (c) =>
      call(c, (role) => transcribeRequest(role, c.audio, c.keywords), normalizeTranscribe),
    imageEdit: (c) =>
      call(c, (role) => imageEditRequest(role, c.prompt, c.images), normalizeImages),
    segment: (c) => call(c, (role) => segmentRequest(role, c.prompt, c.image), normalizeResponses),
    totalCostUsd: () => totalCost,
  };
}
