"""Parse SAM 3.1 special-token output into boxes and masks.

Grammar: https://dev.meta.ai/docs/sam/reading-segmentation
    <Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;x=0;y=0[;c=..];data=H,W,<enc>payload|>,id...

Mask payloads use a base85 alphabet that excludes `" \\ , ; < > |`, so splitting on `|`, `;` and `,`
is safe. Only the mask decoding needs Meta's `meta-sam-parser` package; boxes need nothing.
"""

import re
from dataclasses import dataclass

_FRAME = re.compile(r"^<(\d+)f>")
_RECORD = re.compile(r",?(\d+)<\|box;([^|]*)\|><\|mask;([^|]*)\|>")
_ENCODINGS = {"~": "lossless", "!": "one_bit"}


@dataclass(frozen=True)
class Box:
    x1: int
    y1: int
    x2: int
    y2: int
    frame_w: int
    frame_h: int
    confidence: float | None


@dataclass(frozen=True)
class Mask:
    height: int
    width: int
    encoding: str
    payload: str


@dataclass(frozen=True)
class Record:
    frame: int
    object_id: int
    box: Box
    mask: Mask


def _fields(body):
    return dict(part.split("=", 1) for part in body.split(";"))


def _box(body):
    f = _fields(body)
    c = f.get("c")
    return Box(int(f["x1"]), int(f["y1"]), int(f["x2"]), int(f["y2"]), int(f["w"]), int(f["h"]),
               float(c) if c is not None else None)


def _mask(body):
    height, width, payload = _fields(body)["data"].split(",", 2)
    return Mask(int(height), int(width), _ENCODINGS[payload[0]], payload)


def parse(text):
    """Every record in the output text, one line per frame. Empty text means zero matches."""
    records = []
    for line in text.splitlines():
        frame = _FRAME.match(line)
        if not frame:
            continue
        rest = line[frame.end():]
        for m in _RECORD.finditer(rest):
            records.append(Record(int(frame.group(1)), int(m.group(1)), _box(m.group(2)), _mask(m.group(3))))
    return records


def mask_raster(mask):
    """Row-major bytes of 0/1, height * width long. The raster covers the record's box."""
    from meta_sam_parser import SegmentationMask, decode_mask_to_raster

    return decode_mask_to_raster(SegmentationMask(mask.encoding, mask.payload, mask.width, mask.height))


def box_prompt(boxes, frame_w, frame_h):
    """Box prompts for one image: object id i marks boxes[i]. SAM takes at most 16 objects per call."""
    if len(boxes) > 16:
        raise ValueError(f"{len(boxes)} boxes exceed SAM's limit of 16 prompted objects")
    tokens = [f"{i}<|box;x1={x1};y1={y1};x2={x2};y2={y2};w={frame_w};h={frame_h}|>"
              for i, (x1, y1, x2, y2) in enumerate(boxes)]
    return "<0f>" + ",".join(tokens)
