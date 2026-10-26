import re

REDACTED = "[REDACTED]"
_BEARER = re.compile(r"Bearer\s+\S+")
_BASE64 = re.compile(r"[A-Za-z0-9+/=]{200,}")


def redact(value, secret):
    if isinstance(value, dict):
        return {k: redact(v, secret) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, secret) for v in value]
    if isinstance(value, str):
        value = _BEARER.sub(REDACTED, value).replace(secret, REDACTED)
        return _BASE64.sub(lambda m: f"[base64: {len(m.group())} chars]", value)
    return value


# USD per 1M tokens: (input, cached input, output). Standard mode, from dev.meta.ai/docs/pricing-rate-limits.
TOKEN_PRICES = {
    "muse-spark-1.3": (1.25, 0.15, 4.25),
    "muse-wonder-1.0": (4.00, 0.20, 20.00),
}
SEARCH_PRICE = 2.50 / 1000
IMAGE_PRICES = {"muse-image-1.0": 0.01, "sam-3.1": 2.50 / 1000}
AUDIO_PRICE_PER_SECOND = {"muse-voice-transcribe-1.0": 0.18 / 3600}


def cost_usd(model, usage, searches=0, images=0, audio_seconds=0):
    if model in IMAGE_PRICES:
        return images * IMAGE_PRICES[model]
    if model in AUDIO_PRICE_PER_SECOND:
        return int(audio_seconds) * AUDIO_PRICE_PER_SECOND[model]
    input_price, cached_price, output_price = TOKEN_PRICES[model]
    # Responses API names first, Chat Completions names as fallback.
    input_tokens = usage.get("input_tokens", usage.get("prompt_tokens", 0))
    details = usage.get("input_tokens_details") or usage.get("prompt_tokens_details") or {}
    cached = details.get("cached_tokens", 0)
    output_tokens = usage.get("output_tokens", usage.get("completion_tokens", 0))
    tokens = (input_tokens - cached) * input_price + cached * cached_price + output_tokens * output_price
    return tokens / 1_000_000 + searches * SEARCH_PRICE
