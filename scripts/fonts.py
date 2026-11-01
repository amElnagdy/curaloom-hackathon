"""Writes the Noto fonts that src/app/layout.tsx loads (#43) into src/app/fonts/, with OFL.txt.

Each font comes from github.com/google/fonts at a pinned commit and must match its SHA-256. The
script fixes the width axis at 100, keeps the weight axis (100 to 900) and keeps only the
characters FONTS lists. Noto Sans SC keeps the Chinese characters in demo/fixtures/ and the 3755
characters of GB 2312 level 1, so run the script again after recording new fixtures.

Run from the repo root, with a folder outside the repo for the downloads:
    uv run --with fonttools==4.67.0 --with brotli==1.2.0 scripts/fonts.py <download folder>
"""

import hashlib
import json
import sys
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

COMMIT = "6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec"
OUT = Path("src/app/fonts")
FIXTURES = [Path("demo/fixtures/pages"), Path("demo/fixtures/responses")]

# The unicode-range of the Google Fonts subsets with these names.
LATIN = (
    "U+0000-00FF U+0131 U+0152-0153 U+02BB-02BC U+02C6 U+02DA U+02DC U+0304 U+0308 U+0329"
    " U+2000-206F U+20AC U+2122 U+2191 U+2193 U+2212 U+2215 U+FEFF U+FFFD"
)
CYRILLIC = "U+0301 U+0400-045F U+0490-0491 U+04B0-04B1 U+2116"
ARABIC = (
    "U+0600-06FF U+0750-077F U+0870-08FF U+200C-200E U+2010-2011 U+204F U+2E41 U+FB50-FDFF"
    " U+FE70-FEFC"
)
CJK_PUNCTUATION = "U+3000-303F U+FF00-FFEF"
# Only Noto Sans SC has arrows, such as the ← on the plan page.
ARROWS = "U+2190-21FF"


def codepoints(ranges: str) -> set[int]:
    points: set[int] = set()
    for item in ranges.split():
        start, _, end = item.removeprefix("U+").partition("-")
        points.update(range(int(start, 16), int(end or start, 16) + 1))
    return points


def gb2312_level1() -> set[int]:
    points: set[int] = set()
    for row in range(0xB0, 0xD8):
        for cell in range(0xA1, 0xFF):
            try:
                points.add(ord(bytes([row, cell]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    return points


def fixture_han() -> set[int]:
    def is_han(point: int) -> bool:
        return 0x3400 <= point <= 0x9FFF or 0xF900 <= point <= 0xFAFF or 0x20000 <= point

    points: set[int] = set()
    for folder in FIXTURES:
        for file in folder.glob("*.json"):
            text = json.dumps(json.loads(file.read_text()), ensure_ascii=False)
            points.update(p for p in map(ord, text) if is_han(p))
    return points


class Font(NamedTuple):
    file: str
    source: str  # path under ofl/ in google/fonts
    sha256: str
    keep: Callable[[], set[int]]


FONTS = [
    Font(
        "NotoSans.woff2",
        "notosans/NotoSans[wdth,wght].ttf",
        "bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d",
        lambda: codepoints(f"{LATIN} {CYRILLIC}"),
    ),
    Font(
        "NotoSansArabic.woff2",
        "notosansarabic/NotoSansArabic[wdth,wght].ttf",
        "63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e",
        lambda: codepoints(f"{ARABIC} {LATIN}"),
    ),
    Font(
        "NotoSansSC.woff2",
        "notosanssc/NotoSansSC[wght].ttf",
        "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
        lambda: codepoints(f"{LATIN} {ARROWS} {CJK_PUNCTUATION}")
        | gb2312_level1()
        | fixture_han(),
    ),
]


def fetch(source: str, folder: Path) -> Path:
    target = folder / source.replace("/", "_")
    if not target.exists():
        path = urllib.parse.quote(source)
        url = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/{path}"
        with urllib.request.urlopen(url, timeout=60) as response:
            target.write_bytes(response.read())
    return target


def build(source: Path, unicodes: set[int], out: Path) -> None:
    font = TTFont(source, recalcTimestamp=False)
    options = subset.Options(layout_features=["*"], name_IDs=["*"], hinting=False)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    if any(axis.axisTag == "wdth" for axis in font["fvar"].axes):
        font = instancer.instantiateVariableFont(font, {"wdth": 100})
    font.flavor = "woff2"
    font.save(out)


# Each font's copyright line, then the licence text the three OFL.txt files share.
def licence(folder: Path) -> str:
    texts = [fetch(f"{font.source.split('/')[0]}/OFL.txt", folder).read_text() for font in FONTS]
    heads, bodies = zip(*(text.split("\n\n", 1) for text in texts))
    if len(set(bodies)) != 1:
        raise SystemExit("The OFL texts differ beyond their copyright lines")
    return "\n".join(heads) + "\n\n" + bodies[0]


def main(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for font in FONTS:
        source = fetch(font.source, folder)
        if hashlib.sha256(source.read_bytes()).hexdigest() != font.sha256:
            raise SystemExit(f"{source} does not match its SHA-256")
        build(source, font.keep(), OUT / font.file)
        print(f"{OUT / font.file}: {(OUT / font.file).stat().st_size} bytes")
    (OUT / "OFL.txt").write_text(licence(folder))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: scripts/fonts.py <download folder>")
    main(Path(sys.argv[1]))
