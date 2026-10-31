from relabel import compare_transcripts

LABELS = [
    {"src": "East", "ar": "الشرق"},
    {"src": "East", "ar": "الشرق"},
    {"src": "Grand Total", "ar": "المجموع الكلي"},
]
SOURCE = ["East", "66", "East", "80", "Grand Total", "1/31/2005"]


def test_a_faithful_transcript_passes():
    texts = ["الشرق", "66", "الشرق", "80", "المجموع  الكلي", "1/31/2005"]

    assert compare_transcripts(LABELS, SOURCE, texts)["pass"] is True


def test_a_transcript_that_reads_final_ya_as_alef_maqsura_still_matches():
    texts = ["الشرق", "66", "الشرق", "80", "المجموع الكلى", "1/31/2005"]

    assert compare_transcripts(LABELS, SOURCE, texts)["pass"] is True


def test_a_label_drawn_once_instead_of_twice_is_missing():
    texts = ["الشرق", "66", "East", "80", "المجموع الكلي", "1/31/2005"]

    verdict = compare_transcripts(LABELS, SOURCE, texts)

    assert verdict["pass"] is False
    assert verdict["missing"] == {"الشرق": 1}
    assert verdict["leftover_source"] == ["East"]


def test_a_changed_number_fails_even_when_every_label_is_right():
    texts = ["الشرق", "66", "الشرق", "88", "المجموع الكلي", "1/31/2005"]

    verdict = compare_transcripts(LABELS, SOURCE, texts)

    assert verdict["pass"] is False
    assert verdict["numbers"] == {"lost": {"80": 1}, "added": {"88": 1}}
