# Spike: Meta Model API access from Egypt (#7)

**Decision: GO.** Every planned model and feature works from Egypt with a standard-tier key, and Ahmed confirmed in #10 that the Geographic Use Policy permits it.

## Question

Does a Meta Model API key work from Egypt for every model the product plans to use? What are the latency, the limits, and the exact response shapes that later issues depend on?

## Method

`spikes/api_access/smoke.py` makes one live call per model and feature against `https://api.meta.ai/v1` from Cairo, on 2026-10-27, using standard mode only. It reads the key from `.env` only. Each call is redacted before anything is written: the key, `Bearer` values and base64 blobs are removed.

- Raw redacted responses: [`api-access.results.json`](api-access.results.json)
- Trace (one event per call, no secrets): [`api-access.trace.jsonl`](api-access.trace.jsonl)
- Re-run from the repo root with `uv run --with requests spikes/api_access/smoke.py`. One run costs about $0.12.

Deviations from the issue:

- **Audio clip length:** the transcription clip is 17 s, not the 10 s the issue asked for. The Arabic sentence spoken by the macOS voice ran longer, and this does not change the result.
- **Web search cost:** recomputed from the saved response after review. The first version billed all 9 `web_search_call` items as searches, but only the 5 `search` actions are billed; the 4 `open_page` actions are not.

`GET /v1/models` also returned HTTP 200 in 1.5 s. It lists `muse-spark-1.1`, `muse-spark-1.2`, `muse-spark-1.3`, `muse-spark-1.2-contributor`, `muse-spark-1.3-contributor`, `muse-wonder-1.0`, `muse-voice-transcribe-1.0`, `muse-image-1.0` and `sam-3.1`.

## Result

```json
{"model":"muse-spark-1.3","feature":"chat","endpoint":"/chat/completions","ok":true,"latency_ms":6692,"error":null,"cost_usd":0.0036,"notes":"763 of 851 output tokens were reasoning"}
{"model":"muse-spark-1.3","feature":"tool_call","endpoint":"/chat/completions","ok":true,"latency_ms":3856,"error":null,"cost_usd":0.0015,"notes":"finish_reason tool_calls; Arabic prompt mapped to topic 'data analysis', language 'en'"}
{"model":"muse-spark-1.3","feature":"tool_call","endpoint":"/responses","ok":true,"latency_ms":4030,"error":null,"cost_usd":0.0014,"notes":"function_call output item"}
{"model":"muse-spark-1.3","feature":"json_schema","endpoint":"/chat/completions","ok":true,"latency_ms":2750,"error":null,"cost_usd":0.0017,"notes":"response_format strict; output parsed and matched schema"}
{"model":"muse-spark-1.3","feature":"json_schema","endpoint":"/responses","ok":true,"latency_ms":6706,"error":null,"cost_usd":0.0035,"notes":"text.format strict; same parsed result"}
{"model":"muse-spark-1.3","feature":"web_search","endpoint":"/responses","ok":true,"latency_ms":15634,"error":null,"cost_usd":0.0849,"notes":"5 searches + 4 page opens, 50,869 input tokens, 4 url_citation annotations; answer correct (pandas 3.1.0, 2026-10-22)"}
{"model":"muse-wonder-1.0","feature":"chat","endpoint":"/chat/completions","ok":true,"latency_ms":8456,"error":null,"cost_usd":0.0076,"notes":"fluent Arabic"}
{"model":"muse-voice-transcribe-1.0","feature":"transcribe","endpoint":"/asr/transcribe","ok":true,"latency_ms":4450,"error":null,"cost_usd":0.0008,"notes":"17 s synthetic Arabic clip (macOS 'Majed' voice); near-verbatim transcript"}
{"model":"muse-image-1.0","feature":"image","endpoint":"/images/generations","ok":true,"latency_ms":8201,"error":null,"cost_usd":0.01,"notes":"returns webp as b64_json by default"}
{"model":"sam-3.1","feature":"segment","endpoint":"/responses (stream)","ok":true,"latency_ms":1822,"error":null,"cost_usd":0.0025,"notes":"segmented 'apple' in the Muse Image output; special-token text"}
```

The run cost **$0.117** in total, and the web search call was 72% of that. Most of the web search cost is its 51k input tokens ($0.072); the 5 searches add $0.0125.

Where this report states a fact that comes from Meta's docs and was not exercised in this run, it is marked *(per docs, not tested)*.

## Response shapes

These shapes are copied from the run and redacted. #12, #13, #17 and #28 depend on them.

### Tool calls

The Chat Completions shape is `choices[0].message.tool_calls`, with `finish_reason: "tool_calls"`. `arguments` is a JSON **string**:

```json
{"id": "call_4ba15114-…", "type": "function",
 "function": {"name": "search_open_courses", "arguments": "{\"language\":\"en\",\"topic\":\"data analysis\"}"}}
```

The Responses shape is an `output[]` item of type `function_call`. Return the result with the `call_id` value, not with `id`:

```json
{"type": "function_call", "id": "fc_652bb113-…", "call_id": "call_652bb113-…",
 "name": "search_open_courses", "arguments": "{\"language\":\"en\",\"topic\":\"data analysis\"}", "status": "completed"}
```

### Structured output

- **Chat Completions:** `response_format: {"type": "json_schema", "json_schema": {"name", "strict": true, "schema"}}`. The JSON arrives as a string in `choices[0].message.content`.
- **Responses:** `text: {"format": {"type": "json_schema", "name", "strict": true, "schema"}}`. The JSON arrives as a string in the `output_text` block of the `message` item.

A parameter that belongs to the other endpoint is silently ignored, so it does not configure structured output *(per docs, not tested)*.

### Web search and citations

Web search is available **only on `/responses`** (and on the Messages API), not on Chat Completions *(per docs, not tested: this run called web search on `/responses` only)*. Send `tools: [{"type": "web_search"}]`. Add `include: ["web_search_call.results"]` to also get the raw hits.

`output[]` interleaves `reasoning`, `message` and `web_search_call` items. A `web_search_call` has `action.type` of either `search` (a billed query) or `open_page` (reading a result). Interim messages carry `"phase": "commentary"`. These are progress notes such as "checking sources now…", with no annotations. The **final answer is the `message` item without a `phase`**, and only that item carries citations:

```json
{"type": "output_text", "text": "As of **October 2026**, the latest stable release is **pandas 3.1.0**. …",
 "annotations": [
   {"type": "url_citation", "url": "https://pandas.pydata.org/docs/whatsnew/v3.1.0.html",
    "title": "What’s new in 3.1.0 (October 22, 2026) — pandas 3.1.0 documentation",
    "start_index": 114, "end_index": 189}
 ]}
```

`web_search_call` with `include` returns the following. Snippets came back empty:

```json
{"type": "web_search_call", "id": "ws_call_…", "status": "completed",
 "action": {"type": "search", "query": "latest stable release pandas Python library version"},
 "results": [{"type": "text_result", "title": "pandas (software) - Wikipedia", "url": "https://en.wikipedia.org/wiki/Pandas_(software)", "snippet": ""}]}
```

### Usage

- **Chat Completions:** `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`.
- **Responses:** `input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens` and `output_tokens_details.reasoning_tokens`.
- **SAM:** reports `images_processed`.
- **Muse Image:** reports token counts, but it is billed per image *(per docs, not tested)*.

### Transcription

The request is `POST /asr/transcribe`, multipart with two parts. `request` is a JSON object: `{"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "PUSH_TO_TALK", "languageBias": ["Arabic"]}`. `audio` must be a RIFF WAV file, mono, 16-bit PCM, at 16 or 24 kHz, at most 10 min and 32 MB. Other formats return `400`. A sample response:

```json
{"sessionId": "voyager/transcribe/…", "transcript": "مرحباً، اسمي عمر، اعمل محاسبة في الرياض …", "audioDurationMs": 17040, "turns": []}
```

These are the differences from the spoken text. The audio came from a synthetic voice, so test a real human voice before relying on it.

- **Dropped hamza:** "أعمل" became "اعمل", and "أريد" became "اريد".
- **"محاسبا" became "محاسبة".**
- **"بايثون" became "بيثون".** If #16 uses voice, pass `keywords: ["بايثون"]` for domain terms.

### Images and SAM

`/images/generations` returns `data[0].b64_json`, with `output_format: "webp"` by default. Send `response_format: "url"` to get a temporary signed URL instead *(per docs, not tested)*.

SAM 3.1 runs on `/responses`, streamed. It takes `input_text` (a noun phrase) and `input_image` (a URL or data URL). The output is **special-token text, not JSON**, one box and one mask per match:

```
<0f>0<|box;x1=576;y1=287;x2=1339;y2=1041;w=1920;h=1280|><|mask;x=0;y=0;data=755,764,~!!$'O#K…|>
```

The mask `data` uses an encoding that needs a decoder; see [reading segmentation output](https://dev.meta.ai/docs/sam/reading-segmentation) and the client libraries. The spike sent the webp bytes labelled as `image/png`, and SAM accepted them. #28 should still send the real MIME type.

## Rate limits

These are the documented limits, [per team rather than per key](https://dev.meta.ai/docs/pricing-rate-limits). The last column says whether this run's response headers confirmed them.

| Model | RPM | TPM | Other | Seen in this run |
|---|---|---|---|---|
| `muse-spark-1.3`, `muse-wonder-1.0` | 3,000 | 4,000,000 | | Yes, headers matched |
| `muse-spark-1.3-contributor` | 150 | 3,000,000 | | No, not called |
| `muse-image-1.0` | 150 | – | | Yes, RPM header matched |
| `sam-3.1` | 3,000 | – | | Yes, RPM header matched |
| `muse-voice-transcribe-1.0` | – | – | 256 concurrent streams; 16,000 streams/hour | No: as documented, it returns no `x-ratelimit-*` headers |

Responses include `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens` and `x-ratelimit-remaining-tokens`. On a `429`, back off exponentially with jitter, starting around 500 ms, and honour any `Retry-After` header.

## Implications for later issues

- **#12 (provider layer):** use `/responses` as the main protocol. It is the only one that supports web search and SAM. It also covers tool calls and structured output, so a single protocol serves every feature. Keep Chat Completions only if a library needs it.
- **#17 (Scout):** one grounded query cost about **$0.085** and took **15.6 s**, because the model ran 5 searches, opened 4 pages and read about 51k input tokens. At that price the $150 credit covers roughly 1,750 grounded queries. Cache Scout results for the demo topic (#30), and keep queries narrow, since the docs say focused questions are the most reliable.
- **Cost and latency in general:** reasoning tokens make up most of the output on short calls (for example 763 of 851). Set `reasoning_effort` (`minimal` up to `xhigh`; `none` is not supported; *per docs, not tested*) to `low` or `minimal` for simple steps such as intake turns and grading.
- **#28 (diagram relabel):** SAM output needs a parser for the box and mask tokens, and that work should be in the estimate.
- **#16 (voice input):** viable, with the caveats above.

## Geographic Use Policy (resolved)

Resolved 2026-10-27: Ahmed confirmed in #10 that use from Egypt is allowed. Original note:


I could not read the [Geographic Use Policy](https://dev.meta.ai/legal/geographic-use-policy) because the page renders client-side. Calls that succeed from Egypt show **technical** access, not **policy** approval. Please confirm that Egypt is allowed when you do #10. The spike tried no workaround, such as a VPN, and none was needed.
