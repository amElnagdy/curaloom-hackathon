"""Issue #7 smoke test: one call per model/feature against the Meta Model API.

Run from the repo root:
    uv run --with requests spikes/api_access/smoke.py

Reads MODEL_API_KEY from .env. Writes redacted results and a trace (no secrets) to docs/spikes/.
"""

import json
import os
import subprocess
import time
from pathlib import Path

import requests

from helpers import cost_usd, redact

BASE_URL = "https://api.meta.ai/v1"
TIMEOUT_S = 180
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out"
DOCS = ROOT / "docs" / "spikes"

ARABIC_SPEECH = (
    "مرحبا، اسمي عمر. أعمل محاسبا في الرياض، وأريد أن أصبح محلل بيانات. "
    "عندي خمس ساعات في الأسبوع، وأريد أن أتعلم بايثون وتحليل البيانات خطوة بخطوة."
)

TOOL = {
    "name": "search_open_courses",
    "description": "Search openly licensed courses on a topic in a given source language.",
    "parameters": {
        "type": "object",
        "properties": {
            "topic": {"type": "string"},
            "language": {"type": "string", "enum": ["en", "ru", "zh", "fr"]},
        },
        "required": ["topic", "language"],
        "additionalProperties": False,
    },
}

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "goal": {"type": "string"},
        "hours_per_week": {"type": "integer"},
        "level": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
    },
    "required": ["goal", "hours_per_week", "level"],
    "additionalProperties": False,
}

PROFILE_PROMPT = "أنا عمر، محاسب في الرياض، مبتدئ في البرمجة، وعندي خمس ساعات أسبوعيا لأتعلم تحليل البيانات."


def load_key():
    key = os.environ.get("MODEL_API_KEY", "")
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("MODEL_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        raise SystemExit("MODEL_API_KEY is not set (environment or .env)")
    return key


KEY = load_key()


def call(path, *, json_body=None, files=None, stream=False):
    headers = {"Authorization": f"Bearer {KEY}"}
    if stream:
        headers["Accept"] = "text/event-stream"
    start = time.monotonic()
    try:
        resp = requests.post(
            f"{BASE_URL}{path}", headers=headers, json=json_body, files=files, timeout=TIMEOUT_S, stream=stream
        )
        # Errors come back as plain JSON even when a stream was requested.
        if stream and resp.headers.get("content-type", "").startswith("text/event-stream"):
            body = {"events": _sse_events(resp)}
        else:
            try:
                body = resp.json()
            except ValueError:
                body = {"text": resp.text}
        status, rate = resp.status_code, {k: v for k, v in resp.headers.items() if k.lower().startswith("x-ratelimit")}
    except requests.RequestException as exc:
        body, status, rate = {"exception": repr(exc)}, None, {}
    return body, status, rate, round((time.monotonic() - start) * 1000)


def _sse_events(resp):
    events = []
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: ") or line[6:] == "[DONE]":
            continue
        try:
            events.append(json.loads(line[6:]))
        except ValueError:
            events.append({"type": "unparsed", "data": line[6:]})
    return events


def output_items(body):
    return body.get("output", []) if isinstance(body, dict) else []


def chat_basic():
    body, *meta = call("/chat/completions", json_body={
        "model": "muse-spark-1.3",
        "messages": [{"role": "user", "content": "عرّف تحليل البيانات في جملتين بالعربية الفصحى."}],
    })
    text = body.get("choices", [{}])[0].get("message", {}).get("content")
    return "muse-spark-1.3", "chat", "/chat/completions", body, meta, bool(text), {"text": text}


def chat_tool_call():
    body, *meta = call("/chat/completions", json_body={
        "model": "muse-spark-1.3",
        "messages": [{"role": "user", "content": "ابحث لي عن دورات مفتوحة في تحليل البيانات باللغة الإنجليزية."}],
        "tools": [{"type": "function", "function": TOOL}],
    })
    calls = body.get("choices", [{}])[0].get("message", {}).get("tool_calls")
    return "muse-spark-1.3", "tool_call", "/chat/completions", body, meta, bool(calls), {"tool_calls": calls}


def responses_tool_call():
    body, *meta = call("/responses", json_body={
        "model": "muse-spark-1.3",
        "input": "ابحث لي عن دورات مفتوحة في تحليل البيانات باللغة الإنجليزية.",
        "tools": [{"type": "function", **TOOL}],
    })
    calls = [item for item in output_items(body) if item.get("type") == "function_call"]
    return "muse-spark-1.3", "tool_call", "/responses", body, meta, bool(calls), {"function_calls": calls}


def chat_json_schema():
    body, *meta = call("/chat/completions", json_body={
        "model": "muse-spark-1.3",
        "messages": [{"role": "user", "content": PROFILE_PROMPT}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "learner_profile", "strict": True, "schema": PROFILE_SCHEMA},
        },
    })
    content = body.get("choices", [{}])[0].get("message", {}).get("content")
    parsed = _parse_profile(content)
    return "muse-spark-1.3", "json_schema", "/chat/completions", body, meta, parsed is not None, {"parsed": parsed}


def responses_json_schema():
    body, *meta = call("/responses", json_body={
        "model": "muse-spark-1.3",
        "input": PROFILE_PROMPT,
        "text": {"format": {"type": "json_schema", "name": "learner_profile", "strict": True, "schema": PROFILE_SCHEMA}},
    })
    parsed = _parse_profile(_output_text(body))
    return "muse-spark-1.3", "json_schema", "/responses", body, meta, parsed is not None, {"parsed": parsed}


def responses_web_search():
    body, *meta = call("/responses", json_body={
        "model": "muse-spark-1.3",
        "input": "What is the latest stable release of the pandas Python library as of this month, and when was it released? Cite sources.",
        "tools": [{"type": "web_search"}],
        "include": ["web_search_call.results"],
    })
    calls = [item for item in output_items(body) if item.get("type") == "web_search_call"]
    # Only "search" actions are billed as search queries; "open_page" reads a result.
    searches = [c for c in calls if c.get("action", {}).get("type") == "search"]
    citations = [
        ann
        for block in _final_message_content(body)
        for ann in block.get("annotations", []) if ann.get("type") == "url_citation"
    ]
    return "muse-spark-1.3", "web_search", "/responses", body, meta, bool(citations), {
        "searches": len(searches), "page_opens": len(calls) - len(searches),
        "citations": citations, "sample_web_search_call": searches[:1],
    }


def wonder_short():
    body, *meta = call("/chat/completions", json_body={
        "model": "muse-wonder-1.0",
        "messages": [{"role": "user", "content": "اقترح ثلاثة عناوين قصيرة لوحدات دورة مبتدئة في تحليل البيانات."}],
    })
    text = body.get("choices", [{}])[0].get("message", {}).get("content")
    return "muse-wonder-1.0", "chat", "/chat/completions", body, meta, bool(text), {"text": text}


def make_arabic_wav():
    OUT.mkdir(exist_ok=True)
    aiff, wav = OUT / "arabic.aiff", OUT / "arabic.wav"
    subprocess.run(["say", "-v", "Majed", "-o", str(aiff), ARABIC_SPEECH], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@24000", "-c", "1", str(aiff), str(wav)], check=True)
    info = subprocess.run(["afinfo", str(wav)], check=True, capture_output=True, text=True).stdout
    seconds = float(next(line for line in info.splitlines() if "estimated duration" in line).split()[2])
    return wav, seconds


def voice_transcribe():
    wav, seconds = make_arabic_wav()
    settings = {"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "PUSH_TO_TALK", "languageBias": ["Arabic"]}
    with wav.open("rb") as audio:
        body, *meta = call("/asr/transcribe", files={
            "request": (None, json.dumps(settings), "application/json"),
            "audio": ("arabic.wav", audio, "audio/wav"),
        })
    ok = meta[0] == 200 and bool(json.dumps(body, ensure_ascii=False).strip("{}"))
    return "muse-voice-transcribe-1.0", "transcribe", "/asr/transcribe", body, meta, ok, {
        "audio_seconds": seconds, "spoken_text": ARABIC_SPEECH,
    }


def image_generate():
    body, *meta = call("/images/generations", json_body={
        "model": "muse-image-1.0",
        "prompt": "a single red apple on a plain wooden table, studio lighting, photorealistic",
        "n": 1,
    })
    data = body.get("data") or []
    return "muse-image-1.0", "image", "/images/generations", body, meta, bool(data and data[0].get("b64_json")), {
        "images": len(data),
    }


def sam_segment(image_b64):
    body, *meta = call("/responses", stream=True, json_body={
        "model": "sam-3.1",
        "stream": True,
        "input": [{
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": "apple"},
                {"type": "input_image", "image_url": f"data:image/png;base64,{image_b64}"},
            ],
        }],
    })
    events = body.get("events", [])
    completed = next((e.get("response") for e in events if e.get("type") == "response.completed"), None)
    text = "".join(e.get("delta", "") for e in events if e.get("type") == "response.output_text.delta")
    return "sam-3.1", "segment", "/responses (stream)", body, meta, bool(completed) and meta[0] == 200, {
        "event_types": sorted({e.get("type") for e in events}),
        "output_text_prefix": text[:1500],
        "usage": (completed or {}).get("usage"),
    }


def _final_message_content(body):
    # Interim progress notes carry "phase": "commentary"; the final answer has no phase.
    finals = [item for item in output_items(body) if item.get("type") == "message" and not item.get("phase")]
    return finals[-1].get("content", []) if finals else []


def _output_text(body):
    return "".join(
        block.get("text", "") for block in _final_message_content(body) if block.get("type") == "output_text"
    )


def _parse_profile(content):
    try:
        parsed = json.loads(content or "")
    except ValueError:
        return None
    return parsed if set(PROFILE_SCHEMA["required"]) <= set(parsed) else None


def record(model, feature, endpoint, body, meta, ok, extract):
    status, rate, latency_ms = meta
    usage = body.get("usage") or extract.get("usage") or {}
    error = None if status == 200 else body
    cost = None
    if status == 200:
        cost = cost_usd(
            model,
            usage,
            searches=extract.get("searches", 0),
            images=extract.get("images", 1 if model == "sam-3.1" else 0),
            audio_seconds=extract.get("audio_seconds", 0),
        )
    return redact({
        "model": model, "feature": feature, "endpoint": endpoint, "ok": bool(ok), "http_status": status,
        "latency_ms": latency_ms, "error": error, "cost_usd": cost, "usage": usage, "rate_limit_headers": rate,
        "extract": extract, "raw": body,
    }, KEY)


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    trace_path = DOCS / "api-access.trace.jsonl"
    results = []
    checks = [chat_basic, chat_tool_call, responses_tool_call, chat_json_schema, responses_json_schema,
              responses_web_search, wonder_short, voice_transcribe, image_generate]
    image_b64 = None
    with trace_path.open("w") as trace:
        for check in checks + [None]:
            if check is None:
                if not image_b64:
                    break
                result = record(*sam_segment(image_b64))
            else:
                args = check()
                if check is image_generate and args[4][0] == 200 and args[5]:
                    image_b64 = args[3]["data"][0]["b64_json"]
                result = record(*args)
            results.append(result)
            event = {k: result[k] for k in ("model", "feature", "endpoint", "ok", "http_status", "latency_ms", "cost_usd")}
            trace.write(json.dumps({"type": "model_call", "at": time.time(), **event}) + "\n")
            print(f"{'OK  ' if result['ok'] else 'FAIL'} {result['model']:<27} {result['feature']:<12} "
                  f"{result['endpoint']:<22} {result['http_status']} {result['latency_ms']}ms")
    serialized = json.dumps(results, ensure_ascii=False, indent=2)
    assert KEY not in serialized + trace_path.read_text(), "API key leaked into output"
    (DOCS / "api-access.results.json").write_text(serialized)
    total = sum(r["cost_usd"] or 0 for r in results)
    print(f"total cost ≈ ${total:.4f}")


if __name__ == "__main__":
    main()
