// Meta Model API wire format: request builders and response normalizers.
// Response shapes are the ones recorded by spike #7 (docs/spikes/api-access.md).

import type { RoleConfig, Usage } from "./models.ts";

export const META_BASE_URL = "https://api.meta.ai/v1";

export type WireRequest = {
  path: string;
  json?: Record<string, unknown>;
  form?: { request: Record<string, unknown>; audio: Uint8Array; mime: string };
  stream?: boolean;
};

export type ImageInput = { b64: string; mime: string };
export type FunctionTool = { name: string; description: string; parameters: object };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type Citation = { url: string; title: string; snippet: string };
// A JSON Schema sent as a strict `json_schema` response format.
export type ResponseFormat<S extends object = object> = { name: string; schema: S };

export type Normalized = {
  text: string;
  json: unknown;
  tool_calls: ToolCall[];
  citations: Citation[];
  image: { b64: string; format: string } | null;
  usage: Usage;
};

type ResponsesInput = {
  instructions?: string;
  input: string | unknown[];
  tools?: unknown[];
  format?: ResponseFormat;
};

type OutputItem = {
  type: string;
  phase?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  action?: { type?: string };
  content?: { type: string; text?: string; annotations?: Annotation[] }[];
};
type Annotation = {
  type: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
};
type ResponsesBody = {
  output?: OutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    images_processed?: number;
  };
};

const dataUrl = (image: ImageInput) => `data:${image.mime};base64,${image.b64}`;

export function responsesRequest(role: RoleConfig, input: ResponsesInput): WireRequest {
  const json: Record<string, unknown> = { model: role.model, input: input.input };
  if (input.instructions) json.instructions = input.instructions;
  if (role.reasoning) json.reasoning = { effort: role.reasoning };
  if (role.max_output_tokens) json.max_output_tokens = role.max_output_tokens;
  if (input.tools?.length) json.tools = input.tools;
  if (input.format) {
    json.text = { format: { type: "json_schema", strict: true, ...input.format } };
  }
  return { path: "/responses", json };
}

export function functionTools(tools: FunctionTool[]): unknown[] {
  return tools.map((tool) => ({ type: "function", ...tool }));
}

export function transcribeRequest(
  role: RoleConfig,
  audio: Uint8Array,
  keywords: string[] | undefined,
): WireRequest {
  const request: Record<string, unknown> = {
    model: role.model,
    audioEncoding: "WAV",
    mode: "PUSH_TO_TALK",
    languageBias: ["Arabic"],
  };
  if (keywords?.length) request.keywords = keywords;
  return { path: "/asr/transcribe", form: { request, audio, mime: "audio/wav" } };
}

export function imageEditRequest(
  role: RoleConfig,
  prompt: string,
  images: ImageInput[],
): WireRequest {
  return {
    path: "/images/edits",
    json: {
      model: role.model,
      prompt,
      n: 1,
      images: images.map((image) => ({ image_url: dataUrl(image) })),
    },
  };
}

// SAM answers only as a stream; the transport keeps the `response.completed` payload.
export function segmentRequest(role: RoleConfig, prompt: string, image: ImageInput): WireRequest {
  return {
    path: "/responses",
    stream: true,
    json: {
      model: role.model,
      stream: true,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl(image) },
          ],
        },
      ],
    },
  };
}

const EMPTY: Normalized = {
  text: "",
  json: null,
  tool_calls: [],
  citations: [],
  image: null,
  usage: {},
};

// The final answer is the last `message` without a `phase`; interim ones are "commentary".
export function normalizeResponses(raw: unknown): Normalized {
  const body = raw as ResponsesBody;
  const output = body.output ?? [];
  const final = output.filter((o) => o.type === "message" && !o.phase).at(-1);
  const blocks = (final?.content ?? []).filter((c) => c.type === "output_text");
  const text = blocks.map((c) => c.text ?? "").join("");

  const citations = new Map<string, Citation>();
  for (const block of blocks) {
    for (const a of block.annotations ?? []) {
      if (a.type !== "url_citation" || !a.url || citations.has(a.url)) continue;
      const snippet = (block.text ?? "").slice(a.start_index ?? 0, a.end_index ?? 0);
      citations.set(a.url, { url: a.url, title: a.title ?? "", snippet });
    }
  }

  const tool_calls = output
    .filter((o) => o.type === "function_call")
    .map((o) => ({
      id: o.call_id ?? "",
      name: o.name ?? "",
      args: JSON.parse(o.arguments || "{}") as Record<string, unknown>,
    }));

  const usage = body.usage ?? {};
  return {
    ...EMPTY,
    text,
    tool_calls,
    citations: [...citations.values()],
    usage: {
      input: usage.input_tokens ?? 0,
      cachedInput: usage.input_tokens_details?.cached_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      // Only `search` actions are billed; `open_page` reads a result.
      searches: output.filter((o) => o.type === "web_search_call" && o.action?.type === "search")
        .length,
      images: usage.images_processed ?? 0,
    },
  };
}

export function normalizeTranscribe(raw: unknown): Normalized {
  const body = raw as { transcript?: string; audioDurationMs?: number };
  return {
    ...EMPTY,
    text: body.transcript ?? "",
    usage: { audioSeconds: (body.audioDurationMs ?? 0) / 1000 },
  };
}

export function normalizeImages(raw: unknown): Normalized {
  const body = raw as { data?: { b64_json?: string }[]; output_format?: string };
  const data = body.data ?? [];
  const b64 = data[0]?.b64_json;
  return {
    ...EMPTY,
    image: b64 ? { b64, format: body.output_format ?? "webp" } : null,
    usage: { images: data.length },
  };
}

// Returns the `response` of the `response.completed` event in a server-sent event stream.
export function completedFromStream(text: string): unknown {
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = JSON.parse(line.slice(5)) as { type?: string; response?: unknown };
    if (event.type === "response.completed") return event.response;
  }
  throw new Error("stream ended without response.completed");
}
