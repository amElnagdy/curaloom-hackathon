import pytest

from helpers import cost_usd, redact


def test_redact_removes_api_key_anywhere_in_nested_data():
    data = {"headers": {"authorization": "Bearer sk-secret-123"}, "notes": ["key sk-secret-123 leaked"]}

    assert redact(data, secret="sk-secret-123") == {
        "headers": {"authorization": "[REDACTED]"},
        "notes": ["key [REDACTED] leaked"],
    }


def test_redact_collapses_base64_blobs_but_keeps_short_strings():
    blob = "iVBORw0KGgo" + "A" * 489
    data = {"b64_json": blob, "image_url": "data:image/png;base64," + blob, "id": "img_123"}

    assert redact(data, secret="sk-secret-123") == {
        "b64_json": "[base64: 500 chars]",
        "image_url": "data:image/png;base64,[base64: 500 chars]",
        "id": "img_123",
    }


def test_cost_of_spark_responses_call_with_cache_and_one_search():
    # 8,000 fresh input @ $1.25/M + 2,000 cached @ $0.15/M + 1,000 output @ $4.25/M + 1 search @ $2.50/1k
    usage = {"input_tokens": 10_000, "output_tokens": 1_000, "input_tokens_details": {"cached_tokens": 2_000}}

    assert cost_usd("muse-spark-1.3", usage, searches=1) == pytest.approx(0.01705)


def test_cost_reads_chat_completions_usage_names():
    # 1,000 input @ $4.00/M + 500 output @ $20.00/M
    usage = {"prompt_tokens": 1_000, "completion_tokens": 500, "prompt_tokens_details": {"cached_tokens": 0}}

    assert cost_usd("muse-wonder-1.0", usage) == pytest.approx(0.014)


@pytest.mark.parametrize(
    ("model", "units", "expected"),
    [
        ("muse-image-1.0", {"images": 2}, 0.02),  # $0.01 per image
        ("sam-3.1", {"images": 1}, 0.0025),  # $2.50 per 1,000 images
        ("muse-voice-transcribe-1.0", {"audio_seconds": 10}, 0.0005),  # $0.18 per hour
    ],
)
def test_cost_of_unit_priced_models(model, units, expected):
    assert cost_usd(model, usage={}, **units) == pytest.approx(expected)
