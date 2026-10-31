"""Issue #9 spike: relabel diagrams into Arabic with Meta models, three ways.

1. Spark 1.3 vision reads every label, translates it and boxes it (0-1000 grid).
2. SAM 3.1 segments label regions: concept prompts ("text", ...) and box prompts seeded by Spark.
3a. Muse Image 1.0 edits the diagram with the Arabic labels (/images/edits).
3b. SVG fallback: a background-coloured box over each label plus Arabic text in Noto Sans Arabic,
    rendered by headless Chrome.
4. Two checks per candidate: Spark judges it against the source, and Spark transcribes it so code
   can compare the text with the expected labels and the source's numbers.

Run from the repo root:
    uv run --with requests --with pillow --with meta-sam-parser spikes/image_arabic/relabel.py [ids...]

Reads MODEL_API_KEY from .env, or from the file named by ENV_FILE. Every API response is cached in
spikes/image_arabic/out/cache/, keyed by the request, so a rerun spends nothing. Writes evidence
images to docs/spikes/img/ and a redacted results file and trace (no secrets) to docs/spikes/.
"""

import base64
import hashlib
import html
import io
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import requests
from PIL import Image, ImageDraw

import sam_tokens

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "spikes" / "api_access"))
from helpers import cost_usd, redact  # noqa: E402

BASE_URL = "https://api.meta.ai/v1"
TIMEOUT_S = 300
OUT = HERE / "out"
CACHE = OUT / "cache"
DOCS = ROOT / "docs" / "spikes"
IMG = DOCS / "img"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf"
UA = "curaloom-spike/0.1 (https://github.com/amElnagdy/curaloom)"
# Concept prompts tried on every diagram. Only "word" found text, and only on the Chinese one (see the doc).
SAM_PHRASES = ["text", "text label", "word", "words", "label", "letter", "character", "writing", "caption"]
# Controls: the same request shape on a photo and on diagram shapes, to show the calls work.
CONTROL_PHOTOS = {
    "apple": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/1280px-Red_Apple.jpg",
    "sign": "https://upload.wikimedia.org/wikipedia/commons/f/fe/"
            "Street_sign%2C_Wigmore_Street_-_geograph.org.uk_-_6556901.jpg",
}
CONTROLS = [("apple", "apple"), ("sign", "text"), ("sign", "street sign"), ("sign", "letter"),
            ("dwh", "rectangle"), ("dwh", "arrow"), ("dwh", "cylinder")]
EVIDENCE_MAX_W = 1100


@dataclass(frozen=True)
class Diagram:
    id: str
    lang: str
    title: str
    page: str
    file_url: str
    author: str
    license: str


DIAGRAMS = [
    Diagram("pivot", "en", "Pivot table: sum of units by region and ship date",
            "https://commons.wikimedia.org/wiki/File:Pivottable-Pivoted.PNG",
            "https://upload.wikimedia.org/wikipedia/commons/6/63/Pivottable-Pivoted.PNG",
            "Wikidan829, later version by Jbarta (English Wikipedia)", "Public domain"),
    Diagram("flat", "en", "Source data of the pivot table",
            "https://commons.wikimedia.org/wiki/File:Pivottable-Flatdata.png",
            "https://upload.wikimedia.org/wikipedia/commons/3/3a/Pivottable-Flatdata.png",
            "Wikidan829 (English Wikipedia)", "Public domain"),
    Diagram("etl", "zh", "ETL basic flow (ETL基本流程)",
            "https://commons.wikimedia.org/wiki/File:ETL%E5%9F%BA%E6%9C%AC%E6%B5%81%E7%A8%8B.png",
            "https://upload.wikimedia.org/wikipedia/commons/c/ce/ETL%E5%9F%BA%E6%9C%AC%E6%B5%81%E7%A8%8B.png",
            "Aywstc", "CC BY-SA 4.0"),
    Diagram("dwh", "ru", "Data warehouse and data marts overview (Обзор хранилища данных и витрины данных)",
            "https://commons.wikimedia.org/wiki/File:Data_Warehouse_and_Data_Mart_overview-rus.svg",
            "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/72/Data_Warehouse_and_Data_Mart_overview-rus.svg/"
            "1280px-Data_Warehouse_and_Data_Mart_overview-rus.svg.png",
            "MarsJson", "CC BY-SA 4.0"),
]

# Demo glossary terms from demo/fixtures (#19); the glossary owns each term's Arabic form (#8).
GLOSSARY = {"sum": "مجموع", "pivot table": "جدول محوري", "row": "صف", "column": "عمود", "data": "بيانات"}

SPARK_PROMPT = """You are an object grounding expert and a technical translator for Arabic-speaking learners.
The image is a diagram. List every piece of text in it that a learner needs in Arabic: words and phrases in any language.
Skip text that stays as written: numbers, dates, single column letters, row numbers, and acronyms such as ETL, ERP, ODS, SCM or GDP.
Give one entry per separate text block (one table cell, one shape caption, one title line), in reading order. Include repeats: a word that appears in five cells gets five entries.
For each entry:
- src: the text exactly as written.
- ar: a short Modern Standard Arabic translation that fits the same space. Keep any acronym inside the text in Latin letters. Use these glossary terms where they apply: {glossary}.
- box: [x_min, y_min, x_max, y_max] tight around the text only, on a normalized 0-1000 grid with (0,0) at the top-left.
Do not miss any text."""

LABEL_SCHEMA = {
    "type": "object",
    "properties": {
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "src": {"type": "string"},
                    "ar": {"type": "string"},
                    "box": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["src", "ar", "box"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["labels"],
    "additionalProperties": False,
}

MUSE_PROMPT = """Edit this diagram: replace each text below with its Arabic translation, everywhere it appears.
Change nothing else. Keep the layout, shapes, colours, lines, numbers, dates and acronyms exactly as they are.
Write the Arabic right to left, with correctly joined letters, in a plain sans-serif font sized to fit the space of the text it replaces.
{pairs}"""


def load_key():
    key = os.environ.get("MODEL_API_KEY", "")
    env_file = Path(os.environ.get("ENV_FILE", ROOT / ".env"))
    if not key and env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("MODEL_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        raise SystemExit("MODEL_API_KEY is not set (environment, .env, or ENV_FILE)")
    return key


KEY = None


def call(name, path, body, stream=False):
    """POST once per distinct request; later runs read the cached response."""
    global KEY
    digest = hashlib.sha256(json.dumps([path, body], sort_keys=True).encode()).hexdigest()[:12]
    file = CACHE / f"{name}-{digest}.json"
    if file.exists():
        return json.loads(file.read_text())
    KEY = KEY or load_key()
    headers = {"Authorization": f"Bearer {KEY}"}
    if stream:
        headers["Accept"] = "text/event-stream"
    start = time.monotonic()
    try:
        resp = requests.post(f"{BASE_URL}{path}", headers=headers, json=body, timeout=TIMEOUT_S, stream=stream)
        if stream and resp.headers.get("content-type", "").startswith("text/event-stream"):
            out = {"events": _sse_events(resp)}
        else:
            try:
                out = resp.json()
            except ValueError:
                out = {"text": resp.text}
        status = resp.status_code
    except requests.RequestException as exc:
        out, status = {"exception": repr(exc)}, None
    entry = {"name": name, "path": path, "model": body["model"], "status": status,
             "latency_ms": round((time.monotonic() - start) * 1000), "at": time.time(), "body": out}
    CACHE.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(entry, ensure_ascii=False))
    print(f"  {name}: HTTP {status} in {entry['latency_ms']} ms")
    return entry


def _sse_events(resp):
    events = []
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: ") and line[6:] != "[DONE]":
            try:
                events.append(json.loads(line[6:]))
            except ValueError:
                events.append({"type": "unparsed", "data": line[6:]})
    return events


def entry_cost(entry):
    if entry["status"] != 200:
        return 0.0
    body = entry["body"]
    if entry["model"] == "sam-3.1":
        done = next((e["response"] for e in body.get("events", []) if e.get("type") == "response.completed"), {})
        return cost_usd("sam-3.1", {}, images=(done.get("usage") or {}).get("images_processed", 1))
    if entry["model"] == "muse-image-1.0":
        return cost_usd("muse-image-1.0", {}, images=len(body.get("data") or []))
    return cost_usd(entry["model"], body.get("usage") or {})


def fetch(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            path.write_bytes(r.read())
    return path


def png_data_url(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def working_image(d):
    """Upscale small sources by a whole factor so the long side is at least 1000 px."""
    src = Image.open(fetch(d.file_url, OUT / "src" / f"{d.id}.png")).convert("RGB")
    scale = max(1, math.ceil(1000 / max(src.size)))
    img = src.resize((src.width * scale, src.height * scale), Image.LANCZOS) if scale > 1 else src
    return src, img, scale


# --- Spark: read, translate and box every label -------------------------------------------


def spark_labels(d, img):
    glossary = "; ".join(f"{k} = {v}" for k, v in GLOSSARY.items())
    entry = call(f"spark-{d.id}", "/responses", {
        "model": "muse-spark-1.3",
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": SPARK_PROMPT.format(glossary=glossary)},
            {"type": "input_image", "image_url": png_data_url(img)},
        ]}],
        "text": {"format": {"type": "json_schema", "name": "diagram_labels", "strict": True, "schema": LABEL_SCHEMA}},
    })
    labels = []
    for label in json.loads(_final_text(entry))["labels"]:
        x1, y1, x2, y2 = (label["box"] + [0, 0, 0, 0])[:4]
        box = (_clamp(x1 * img.width / 1000, img.width), _clamp(y1 * img.height / 1000, img.height),
               _clamp(x2 * img.width / 1000, img.width), _clamp(y2 * img.height / 1000, img.height))
        labels.append({"src": label["src"], "ar": label["ar"], "spark_box": box})
    return entry, labels


def _clamp(v, limit):
    return max(0, min(limit - 1, round(v)))


# --- SAM: concept prompts and Spark-seeded box prompts ------------------------------------


def sam_call(name, prompt, img):
    entry = call(name, "/responses", {
        "model": "sam-3.1",
        "stream": True,
        "metadata": {"include_confidence": "true"},
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": prompt},
            {"type": "input_image", "image_url": png_data_url(img)},
        ]}],
    }, stream=True)
    events = entry["body"].get("events", [])
    text = "".join(e.get("delta", "") for e in events if e.get("type") == "response.output_text.delta")
    return entry, text, sam_tokens.parse(text)


def sam_concepts(d, img):
    return {phrase: sam_call(f"sam-{d.id}-{phrase.replace(' ', '_')}", phrase, img) for phrase in SAM_PHRASES}


def sam_refine(d, img, labels):
    """One box prompt per Spark box, 16 per call; object id i is label i of the chunk."""
    results = []
    for start in range(0, len(labels), 16):
        chunk = labels[start:start + 16]
        boxes = [_pad(lab["spark_box"], 3, img) for lab in chunk]
        prompt = sam_tokens.box_prompt(boxes, img.width, img.height)
        entry, text, records = sam_call(f"sam-{d.id}-boxes{start // 16}", prompt, img)
        by_id = {r.object_id: r for r in records}
        for i, lab in enumerate(chunk):
            r = by_id.get(i)
            lab["sam_refined_box"] = (r.box.x1, r.box.y1, r.box.x2, r.box.y2) if r else None
        results.append((entry, text, records))
    return results


def _pad(box, p, img):
    x1, y1, x2, y2 = box
    return (max(0, x1 - p), max(0, y1 - p), min(img.width - 1, x2 + p), min(img.height - 1, y2 + p))


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


# --- Muse Image path ----------------------------------------------------------------------


def muse_edit(d, img, labels, n=1, name=None):
    pairs = list(dict.fromkeys((lab["src"], lab["ar"]) for lab in labels))
    prompt = MUSE_PROMPT.format(pairs="\n".join(f'"{src}" -> "{ar}"' for src, ar in pairs))
    entry = call(name or f"muse-{d.id}", "/images/edits", {
        "model": "muse-image-1.0",
        "prompt": prompt,
        "images": [{"image_url": png_data_url(img)}],
        "n": n,
        "size": f"{img.width}x{img.height}",
        "output_format": "png",
    })
    data = entry["body"].get("data") or [] if entry["status"] == 200 else []
    images = [Image.open(io.BytesIO(base64.b64decode(item["b64_json"]))).convert("RGB") for item in data]
    return entry, prompt, images


VERIFY_PROMPT = """Image 1 is a diagram. Image 2 should be the same diagram with only its labels translated into Arabic.
The expected Arabic labels are: {expected}.
Check image 2 against image 1:
- every expected Arabic label appears where its source label was, spelled exactly as given, with joined letters, right to left;
- every number, date, acronym, shape, line and arrow from image 1 is still there and unchanged;
- no source-language label text is left, and nothing new is added.
List every problem you find in issues. Set pass to true only when issues is empty."""

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {"issues": {"type": "array", "items": {"type": "string"}}, "pass": {"type": "boolean"}},
    "required": ["issues", "pass"],
    "additionalProperties": False,
}


def verify(name, img, candidate, labels):
    """Spark judges a relabelled image against the source. It rejected half the good Muse samples."""
    expected = " | ".join(dict.fromkeys(lab["ar"] for lab in labels))
    entry = call(name, "/responses", {
        "model": "muse-spark-1.3",
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": VERIFY_PROMPT.format(expected=expected)},
            {"type": "input_image", "image_url": png_data_url(img)},
            {"type": "input_image", "image_url": png_data_url(candidate)},
        ]}],
        "text": {"format": {"type": "json_schema", "name": "relabel_check", "strict": True, "schema": VERIFY_SCHEMA}},
    })
    return entry, json.loads(_final_text(entry))


READBACK_PROMPT = """List every piece of text in this image exactly as written, in any language or script, including numbers and dates.
Give one entry per separate text block (one table cell, one shape caption, one title line), in reading order.
Do not translate, correct or complete anything."""

READBACK_SCHEMA = {
    "type": "object",
    "properties": {"texts": {"type": "array", "items": {"type": "string"}}},
    "required": ["texts"],
    "additionalProperties": False,
}


def read_back(name, image):
    """Spark transcribes an image. Code, not the model, then compares the text with what was asked for."""
    entry = call(name, "/responses", {
        "model": "muse-spark-1.3",
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": READBACK_PROMPT},
            {"type": "input_image", "image_url": png_data_url(image)},
        ]}],
        "text": {"format": {"type": "json_schema", "name": "transcript", "strict": True, "schema": READBACK_SCHEMA}},
    })
    return entry, json.loads(_final_text(entry))["texts"]


# Spark's transcripts sometimes read a dotted final ي as ى. Matching ignores that, tashkeel and tatweel.
_ARABIC_FOLD = str.maketrans({"ى": "ي", "ـ": None, **{chr(c): None for c in range(0x064B, 0x0653)}})


def _norm(s):
    return " ".join(s.translate(_ARABIC_FOLD).split())


NUMBER = re.compile(r"\d+(?:[./]\d+)*")


def compare_transcripts(labels, source_texts, texts):
    """Missing Arabic labels, source labels still present, and numbers that differ from the source."""
    joined = " ".join(_norm(t) for t in texts)
    expected = Counter(_norm(lab["ar"]) for lab in labels)
    missing = {ar: n - joined.count(ar) for ar, n in expected.items() if joined.count(ar) < n}
    leftover = sorted({lab["src"] for lab in labels if _norm(lab["src"]) in joined})
    before = Counter(NUMBER.findall(" ".join(source_texts)))
    after = Counter(NUMBER.findall(joined))
    numbers = {"lost": dict(before - after), "added": dict(after - before)}
    ok = not missing and not leftover and not numbers["lost"] and not numbers["added"]
    return {"pass": ok, "missing": missing, "leftover_source": leftover, "numbers": numbers}


def _final_text(entry):
    finals = [i for i in entry["body"].get("output", []) if i.get("type") == "message" and not i.get("phase")]
    return "".join(b.get("text", "") for b in finals[-1]["content"] if b.get("type") == "output_text")


# --- SVG fallback ------------------------------------------------------------------------


def _colours(img, box):
    """Background = the most common colour in the box; ink = median of the pixels far from it.

    SAM's masks are filled label regions, not glyphs, so they cannot split ink from background.
    """
    x1, y1, x2, y2 = box
    crop = img.crop((x1, y1, x2 + 1, y2 + 1))
    px = crop.load()
    inside = [px[x, y] for y in range(crop.height) for x in range(crop.width)]
    buckets = Counter((r // 16, g // 16, b // 16) for r, g, b in inside)
    top = buckets.most_common(1)[0][0]
    members = [c for c in inside if (c[0] // 16, c[1] // 16, c[2] // 16) == top]
    bg = tuple(int(statistics.median(c[i] for c in members)) for i in range(3))
    ink = [c for c in inside if sum(abs(c[i] - bg[i]) for i in range(3)) > 180]
    if ink:
        fg = tuple(int(statistics.median(c[i] for c in ink)) for i in range(3))
    else:
        fg = (0, 0, 0) if sum(bg) > 380 else (255, 255, 255)
    return bg, fg


def _runs(flags, min_gap):
    """[start, end] runs of True. Gaps shorter than min_gap merge; None (a ruled line) always splits."""
    runs, broken = [], True
    for i, on in enumerate(flags):
        if on is None:
            broken = True
        elif on:
            if runs and not broken and i - runs[-1][1] <= min_gap:
                runs[-1][1] = i
            else:
                runs.append([i, i])
            broken = False
    return runs


def _pick(runs, lo, hi):
    """The runs overlapping [lo, hi], or else the one nearest its centre."""
    hit = [r for r in runs if r[1] >= lo and r[0] <= hi]
    if hit or not runs:
        return hit
    mid = (lo + hi) / 2
    return [min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - mid))]


def snap_to_ink(img, box):
    """Move a model's box onto the text pixels near it, ignoring table and shape lines.

    Searches a window around the box, treats rows and columns that are mostly ink as ruled lines,
    groups the other ink into words and text lines, and keeps the groups on or nearest the box.
    """
    x1, y1, x2, y2 = box
    h = y2 - y1 + 1
    bg, _ = _colours(img, box)
    wx1, wy1 = max(0, x1 - h), max(0, y1 - round(0.8 * h))
    wx2, wy2 = min(img.width - 1, x2 + h), min(img.height - 1, y2 + round(0.8 * h))
    w, wh = wx2 - wx1 + 1, wy2 - wy1 + 1
    px = img.crop((wx1, wy1, wx2 + 1, wy2 + 1)).load()
    ink = [[sum(abs(px[x, y][i] - bg[i]) for i in range(3)) > 150 for x in range(w)] for y in range(wh)]
    line_rows = {y for y in range(wh) if sum(ink[y]) > 0.8 * w}
    line_cols = {x for x in range(w) if sum(ink[y][x] for y in range(wh)) > 0.8 * wh}
    cols = [None if x in line_cols else any(ink[y][x] for y in range(wh) if y not in line_rows)
            for x in range(w)]
    keep_x = _pick(_runs(cols, round(0.45 * h)), x1 - wx1, x2 - wx1)
    if not keep_x:
        return box
    cx1, cx2 = keep_x[0][0], keep_x[-1][1]
    rows = [None if y in line_rows else any(ink[y][x] for x in range(cx1, cx2 + 1) if x not in line_cols)
            for y in range(wh)]
    keep_y = _pick(_runs(rows, round(0.15 * h)), y1 - wy1, y2 - wy1)
    if not keep_y:
        return box
    return (cx1 + wx1, keep_y[0][0] + wy1, cx2 + wx1, keep_y[-1][1] + wy1)


def _plausible(snapped, box):
    """A snap may shrink or shift a box, but not grow it or wander off it."""
    area = lambda b: (b[2] - b[0] + 1) * (b[3] - b[1] + 1)  # noqa: E731
    h = box[3] - box[1] + 1
    cx, cy = (snapped[0] + snapped[2]) / 2, (snapped[1] + snapped[3]) / 2
    near = box[0] - h / 2 <= cx <= box[2] + h / 2 and box[1] - h / 2 <= cy <= box[3] + h / 2
    return near and area(snapped) <= 1.5 * area(box)


def match_concepts(labels, boxes):
    """Give each label the nearest unused SAM concept box within reach of its Spark box."""
    pairs = []
    for i, lab in enumerate(labels):
        x1, y1, x2, y2 = lab["spark_box"]
        for j, b in enumerate(boxes):
            dx = abs((b[0] + b[2]) / 2 - (x1 + x2) / 2)
            dy = abs((b[1] + b[3]) / 2 - (y1 + y2) / 2)
            if dx < (x2 - x1 + 1) and dy < 1.5 * (y2 - y1 + 1):
                pairs.append((dx + dy, i, j))
    used_labels, used_boxes = set(), set()
    for _, i, j in sorted(pairs):
        if i not in used_labels and j not in used_boxes:
            labels[i]["concept_box"] = boxes[j]
            used_labels.add(i)
            used_boxes.add(j)
    return len(used_labels)


def _hex(c):
    return "#%02x%02x%02x" % c


def svg_overlay(img, labels, box_key, font_path):
    """An SVG of the image with each label covered and rewritten in Arabic, fitted by the browser."""
    rects, texts = [], []
    for i, lab in enumerate(labels):
        x1, y1, x2, y2 = lab[box_key]
        bg, fg = _colours(img, (x1, y1, x2, y2))
        h = y2 - y1 + 1
        pad = max(3, round(h * 0.2))
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        rects.append(f'<rect id="r{i}" x="{x1 - pad}" y="{y1 - pad}" width="{x2 - x1 + 1 + 2 * pad}" '
                     f'height="{h + 2 * pad}" fill="{_hex(bg)}"/>')
        texts.append(
            f'<text data-rect="r{i}" data-w="{x2 - x1 + 1 + pad}" data-cx="{cx}" data-pad="{pad}" '
            f'x="{cx}" y="{cy}" font-size="{h * 1.05:.1f}" fill="{_hex(fg)}" text-anchor="middle" '
            f'dominant-baseline="central" direction="rtl">{html.escape(lab["ar"])}</text>'
        )
    parts = rects + texts  # every cover first, so no cover hides a neighbour's Arabic
    w, hgt = img.width, img.height
    return f"""<!doctype html><html lang="ar"><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Noto Sans Arabic"; src: url("{font_path.as_uri()}"); }}
html, body {{ margin: 0; padding: 0; background: #fff; }}
svg {{ display: block; }}
text {{ font-family: "Noto Sans Arabic"; font-weight: 400; }}
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{hgt}" viewBox="0 0 {w} {hgt}">
<image href="{png_data_url(img)}" width="{w}" height="{hgt}"/>
{"".join(parts)}
</svg>
<script>
document.fonts.load('20px "Noto Sans Arabic"').then(() => {{
  let shrunk = 0, widened = 0;
  for (const t of document.querySelectorAll("text[data-w]")) {{
    const maxW = +t.dataset.w;
    let size = +t.getAttribute("font-size");
    const min = size * 0.6;
    while (t.getComputedTextLength() > maxW && size > min) {{ size -= 0.5; t.setAttribute("font-size", size); shrunk++; }}
    const len = t.getComputedTextLength();
    if (len > maxW) {{
      const r = document.getElementById(t.dataset.rect), pad = +t.dataset.pad;
      r.setAttribute("x", +t.dataset.cx - len / 2 - pad);
      r.setAttribute("width", len + 2 * pad);
      widened++;
    }}
  }}
  document.body.dataset.font = document.fonts.check('20px "Noto Sans Arabic"');
  document.body.dataset.widened = widened;
}});
</script></body></html>"""


def render(html_path, png_path, w, h):
    common = [CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
              "--force-device-scale-factor=1", f"--window-size={w},{h}", "--virtual-time-budget=5000"]
    dom = subprocess.run(common + ["--dump-dom", html_path.as_uri()], capture_output=True, text=True, check=True).stdout
    subprocess.run(common + [f"--screenshot={png_path}", html_path.as_uri()], capture_output=True, check=True)
    font_ok = 'data-font="true"' in dom
    widened = int(dom.split('data-widened="', 1)[1].split('"', 1)[0]) if 'data-widened="' in dom else None
    return font_ok, widened


# --- Evidence ------------------------------------------------------------------------------


def save_evidence(img, name):
    IMG.mkdir(parents=True, exist_ok=True)
    if img.width > EVIDENCE_MAX_W:
        img = img.resize((EVIDENCE_MAX_W, round(img.height * EVIDENCE_MAX_W / img.width)), Image.LANCZOS)
    path = IMG / f"{name}.webp"
    img.save(path, "WEBP", quality=82, method=6)
    return path


def draw_boxes(img, labels):
    """Spark's boxes in blue, SAM's box-prompt boxes in red, the boxes the overlay uses in green."""
    out = img.copy()
    draw = ImageDraw.Draw(out)
    for lab in labels:
        draw.rectangle(lab["spark_box"], outline=(30, 90, 220), width=2)
        if lab.get("sam_refined_box"):
            draw.rectangle(lab["sam_refined_box"], outline=(220, 30, 30), width=1)
        draw.rectangle(lab["best_box"], outline=(20, 160, 60), width=2)
    return out


def stack(images, gap=24):
    """Images one above the other at a common width, for a contact sheet."""
    w = min(i.width for i in images)
    scaled = [i.resize((w, round(i.height * w / i.width)), Image.LANCZOS) for i in images]
    out = Image.new("RGB", (w, sum(i.height for i in scaled) + gap * (len(scaled) - 1)), (255, 255, 255))
    y = 0
    for i in scaled:
        out.paste(i, (0, y))
        y += i.height + gap
    return out


def draw_masks(img, records):
    """Paint every decoded mask at its box origin, to check where SAM's pixels land."""
    out = img.copy().convert("RGBA")
    layer = Image.new("RGBA", out.size, (0, 0, 0, 0))
    for r in records:
        raster = sam_tokens.mask_raster(r.mask)
        m = Image.frombytes("L", (r.mask.width, r.mask.height), bytes(v * 255 for v in raster))
        tint = Image.new("RGBA", m.size, (230, 0, 120, 140))
        layer.paste(tint, (r.box.x1, r.box.y1), m)
    return Image.alpha_composite(out, layer).convert("RGB")


# --- Run -----------------------------------------------------------------------------------


def overlay(d, img, labels, box_key, font_path, suffix):
    html_path = OUT / "svg" / f"{d.id}{suffix}.html"
    png_path = OUT / "svg" / f"{d.id}{suffix}.png"
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(svg_overlay(img, labels, box_key, font_path))
    font_ok, widened = render(html_path, png_path, img.width, img.height)
    return Image.open(png_path).convert("RGB").crop((0, 0, img.width, img.height)), font_ok, widened


def run(d, font_path):
    print(f"{d.id} ({d.lang})")
    src, img, scale = working_image(d)
    spark_entry, labels = spark_labels(d, img)
    concepts = sam_concepts(d, img)
    refine = sam_refine(d, img, labels)
    concept_boxes = [(r.box.x1, r.box.y1, r.box.x2, r.box.y2) for _, _, recs in concepts.values() for r in recs]
    concept_hits = match_concepts(labels, concept_boxes)
    for lab in labels:
        # SAM's box-prompt box when it stays on the label Spark found, else Spark's own box.
        refined = lab.get("sam_refined_box")
        lab["sam_iou_with_spark"] = round(iou(refined, lab["spark_box"]), 2) if refined else None
        lab["sam_box"] = refined if refined and iou(refined, lab["spark_box"]) >= 0.3 else lab["spark_box"]
        # Best box: a SAM concept match when there is one, else Spark's box snapped to the ink.
        lab["snap_box"] = snap_to_ink(img, lab["spark_box"])
        snapped = _plausible(lab["snap_box"], lab["spark_box"])
        lab["best_box"] = lab.get("concept_box") or (lab["snap_box"] if snapped else lab["spark_box"])
        lab["best_from"] = "sam_concept" if lab.get("concept_box") else ("spark_snapped" if snapped else "spark")

    muse_entry, muse_prompt, muse_imgs = muse_edit(d, img, labels)
    muse_img = muse_imgs[0] if muse_imgs else None
    # Two more samples of the same request, to see whether the first result was luck.
    repeat_entry, _, repeats = muse_edit(d, img, labels, n=2, name=f"muse-{d.id}-repeat")
    svg_sam, font_ok, widened = overlay(d, img, labels, "sam_box", font_path, "-sam")
    svg_spark, _, widened_spark = overlay(d, img, labels, "spark_box", font_path, "-spark")
    svg_best, _, widened_best = overlay(d, img, labels, "best_box", font_path, "")

    candidates = [("muse", muse_img), *((f"muse_repeat_{i + 1}", r) for i, r in enumerate(repeats)),
                  ("svg", svg_best)]
    candidates = [(key, c) for key, c in candidates if c is not None]
    checks = {}
    verify_entries = []
    for key, candidate in candidates:
        entry, verdict = verify(f"verify-{d.id}-{key}", img, candidate, labels)
        checks[key] = verdict
        verify_entries.append(entry)
    # Second check: Spark only transcribes, and code compares the transcript with the source's.
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {key: pool.submit(read_back, f"readback-{d.id}-{key}", image)
                   for key, image in [("source", img), *candidates]}
    transcripts = {key: f.result() for key, f in futures.items()}
    source_texts = transcripts["source"][1]
    readbacks = {key: compare_transcripts(labels, source_texts, transcripts[key][1]) for key, _ in candidates}
    readback_entries = [entry for entry, _ in transcripts.values()]

    evidence = {
        "source": save_evidence(src, f"{d.id}-source"),
        "boxes": save_evidence(draw_boxes(img, labels), f"{d.id}-boxes"),
        "masks": save_evidence(draw_masks(img, [r for _, _, recs in refine for r in recs]), f"{d.id}-masks"),
        "svg": save_evidence(svg_best, f"{d.id}-svg"),
        "svg_sam_box_prompt": save_evidence(svg_sam, f"{d.id}-svg-sam"),
        "svg_spark_boxes": save_evidence(svg_spark, f"{d.id}-svg-spark"),
    }
    if muse_img:
        evidence["muse"] = save_evidence(muse_img, f"{d.id}-muse")
    if repeats:
        evidence["muse_repeats"] = save_evidence(stack(repeats), f"{d.id}-muse-repeats")

    entries = [spark_entry, *(e for e, _, _ in concepts.values()), *(e for e, _, _ in refine), muse_entry,
               repeat_entry, *verify_entries, *readback_entries]
    return {
        "diagram": d.__dict__,
        "source_size": list(src.size), "working_size": [img.width, img.height], "scale": scale,
        "labels": labels,
        "sam_concept_matches": {p: len(recs) for p, (_, _, recs) in concepts.items()},
        "labels_with_sam_concept_box": concept_hits,
        "sam_box_prompt": {
            "calls": len(refine),
            "records": sum(len(recs) for _, _, recs in refine),
            "kept": sum(1 for lab in labels if lab["sam_box"] != lab["spark_box"]),
            "output_prefix": refine[0][1][:300] if refine else "",
        },
        "muse": {"ok": muse_img is not None, "http_status": muse_entry["status"],
                 "size": list(muse_img.size) if muse_img else None, "prompt": muse_prompt,
                 "error": None if muse_img else muse_entry["body"],
                 "repeat_samples": len(repeats), "repeat_http_status": repeat_entry["status"]},
        "spark_checks": checks,
        "readback_checks": readbacks,
        "svg": {"font_loaded": font_ok,
                "boxes_widened": {"best": widened_best, "sam_box_prompt": widened, "spark": widened_spark}},
        "evidence": {k: str(v.relative_to(DOCS)) for k, v in evidence.items()},
        "calls": [{"at": e["at"], "name": e["name"], "model": e["model"], "endpoint": e["path"], "http_status": e["status"],
                   "latency_ms": e["latency_ms"], "cost_usd": round(entry_cost(e), 5)} for e in entries],
    }


def controls():
    """SAM concept prompts on a photo and on diagram shapes, with the same request shape."""
    images = {name: Image.open(fetch(url, OUT / "src" / f"control-{name}.jpg")).convert("RGB")
              for name, url in CONTROL_PHOTOS.items()}
    images["dwh"] = working_image(next(d for d in DIAGRAMS if d.id == "dwh"))[1]
    out = []
    for name, phrase in CONTROLS:
        entry, _, recs = sam_call(f"sam-control-{name}-{phrase.replace(' ', '_')}", phrase, images[name])
        out.append({"image": name, "phrase": phrase, "matches": len(recs), "http_status": entry["status"],
                    "cost_usd": round(entry_cost(entry), 5)})
    return out


def main():
    ids = sys.argv[1:] or [d.id for d in DIAGRAMS]
    font_path = fetch(FONT_URL, OUT / "NotoSansArabic.ttf")
    results = [run(d, font_path) for d in DIAGRAMS if d.id in ids]
    control_results = controls()

    trace_lines = []
    for r in results:
        for c in r["calls"]:
            trace_lines.append(json.dumps({
                "type": "model_call", "diagram": r["diagram"]["id"], **c,
                "summary_en": f"{c['name']}: HTTP {c['http_status']}, {c['latency_ms']} ms",
                "summary_ar": f"استدعاء {c['model']} للمخطط {r['diagram']['id']}",
            }, ensure_ascii=False))
    all_spend = sum(entry_cost(json.loads(f.read_text())) for f in CACHE.glob("*.json"))
    summary = {
        "run_cost_usd": round(sum(c["cost_usd"] for r in results for c in r["calls"]), 4),
        "all_cached_calls_cost_usd": round(all_spend, 4),
        "cached_calls": len(list(CACHE.glob("*.json"))),
        "sam_controls": control_results,
        "results": results,
    }
    key = KEY or load_key()
    serialized = json.dumps(redact(summary, key), ensure_ascii=False, indent=2, default=list)
    trace = "\n".join(trace_lines) + "\n"
    assert key not in serialized + trace, "API key leaked into output"
    if ids == [d.id for d in DIAGRAMS]:
        (DOCS / "image-arabic.results.json").write_text(serialized)
        (DOCS / "image-arabic.trace.jsonl").write_text(trace)
    else:
        (OUT / "partial.results.json").write_text(serialized)
    for r in results:
        print(f"{r['diagram']['id']}: {len(r['labels'])} labels; concept matches {r['sam_concept_matches']}; "
              f"box prompt {r['sam_box_prompt']['kept']}/{len(r['labels'])}; muse {r['muse']['ok']}; svg {r['svg']}")
        for key, verdict in r["spark_checks"].items():
            print(f"  check {key}: pass={verdict['pass']} issues={verdict['issues']}")
        for key, verdict in r["readback_checks"].items():
            print(f"  readback {key}: {json.dumps(verdict, ensure_ascii=False)}")
    print("controls:", [(c["image"], c["phrase"], c["matches"]) for c in control_results])
    print(f"run cost ${summary['run_cost_usd']}; all cached calls ${summary['all_cached_calls_cost_usd']}")


if __name__ == "__main__":
    main()
