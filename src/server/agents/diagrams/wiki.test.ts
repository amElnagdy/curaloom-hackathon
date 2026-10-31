import { describe, expect, it } from "vitest";
import { type FileInfo, figuresOf, fileInfoOf, imageLicence, isWikimediaPage } from "./wiki.ts";

// The markup of fr.wikipedia.org/wiki/Tableur, cut down: a heading with its edit link, a thumbnail
// that links to its file page, an icon, and an image that links to another article.
const ARTICLE = `
<h2 class="vector-pinnable-header-label">Sommaire</h2>
<h2 id="De_la_feuille">De la feuille de calcul au tableur</h2><span class="mw-editsection">[<a href="/w/index.php?action=edit">modifier</a>]</span>
<figure typeof="mw:File/Thumb"><a href="https://fr.wikipedia.org/wiki/Fichier:Visicalc.png" class="mw-file-description"><img src="//thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Visicalc.png/250px-Visicalc.png?utm_source=fr.wikipedia.org" data-file-width="560" data-file-height="384" height="171" width="250" class="mw-file-element"/></a><figcaption>Écran de Visicalc.</figcaption></figure>
<a href="/wiki/Fichier:Icon.svg" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Icon.svg/20px-Icon.svg.png" data-file-width="48" data-file-height="48" width="20"/></a>
<h3>Interfaces</h3>
<a href="/wiki/Lotus_1-2-3" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Lotus.png/220px-Lotus.png" data-file-width="640" data-file-height="400" width="220"/></a>
<a href="/wiki/Fichier:Calc_local.png" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/fr/3/3c/Calc_local.png" data-file-width="640" data-file-height="400" width="220"/></a>
<a href="https://fr.wikipedia.org/wiki/Fichier:Visicalc.png" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/commons/7/7a/Visicalc.png" data-file-width="560" data-file-height="384" width="560"/></a>
`;

// A file page, cut down: the author row and the hidden licence table of each licence template.
const FILE_PAGE = (
  licences: string[],
  author = '<a href="https://en.wikipedia.org/wiki/User:Gortu">User:Gortu</a>',
) => `
<div class="fullMedia"><bdi dir="ltr"><a href="//upload.wikimedia.org/wikipedia/commons/7/7a/Visicalc.png?utm_source=fr.wikipedia.org&amp;utm_content=original" class="internal">Original file</a></bdi> <span class="fileInfo">(560 × 384 pixels, <span class="mime-type">image/png</span>)</span></div>
<table><tr><td id="fileinfotpl&#95;aut" class="fileinfo-paramfield" lang="en">Author</td>
<td>
${author}</td></tr></table>
${licences
  .map(
    (l) =>
      `<table class="licensetpl" style="display:none"><tbody><tr><td><span class="licensetpl&#95;short">${l}</span><span class="licensetpl_long">${l}</span></td></tr></tbody></table>`,
  )
  .join("\n")}`;

const FILE_URL = "https://commons.wikimedia.org/wiki/File:Visicalc.png";
const info = (licences: string[], author: string | null = "User:Gortu"): FileInfo => ({
  licences,
  author,
  image_url: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Visicalc.png",
  mime: "image/png",
});

describe("an article's figures", () => {
  it("keeps each image that links to its own file page, under its heading, read on Commons when shared", () => {
    expect(figuresOf(ARTICLE, "https://fr.wikipedia.org/wiki/Tableur")).toEqual([
      {
        file_page: "https://commons.wikimedia.org/wiki/File:Visicalc.png",
        heading: "De la feuille de calcul au tableur",
        width: 560,
        height: 384,
      },
      {
        file_page: "https://fr.wikipedia.org/wiki/Fichier:Calc_local.png",
        heading: "Interfaces",
        width: 640,
        height: 400,
      },
    ]);
  });

  it("reads only Wikimedia wikis", () => {
    expect(isWikimediaPage("https://ru.wikibooks.org/wiki/Microsoft_Excel")).toBe(true);
    expect(isWikimediaPage("https://wikipedia.org.example.com/wiki/Tableur")).toBe(false);
  });
});

describe("a file page", () => {
  it("gives every licence its templates state, the author, and the original file", () => {
    expect(fileInfoOf(FILE_PAGE(["Public domain", "CC0"]), FILE_URL)).toEqual({
      licences: ["Public domain", "CC0"],
      author: "User:Gortu",
      image_url: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Visicalc.png",
      mime: "image/png",
    });
  });

  it("reads an author written in links as one line of text", () => {
    const author =
      '<a href="https://en.wikipedia.org/wiki/User:Wikidan829">Wikidan829</a> at <a href="https://en.wikipedia.org/wiki/">English Wikipedia</a>.';

    expect(fileInfoOf(FILE_PAGE(["Public domain"], author), FILE_URL).author).toBe(
      "Wikidan829 at English Wikipedia.",
    );
  });

  it("fetches an SVG as Wikimedia's PNG rendering", () => {
    const svg = FILE_PAGE(["CC BY-SA 4.0"])
      .replace("7/7a/Visicalc.png?", "9/9c/Pivot_table_example.svg?")
      .replace("image/png", "image/svg+xml");

    expect(fileInfoOf(svg, FILE_URL)).toMatchObject({
      image_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Pivot_table_example.svg/1280px-Pivot_table_example.svg.png",
      mime: "image/png",
    });
  });
});

describe("an image's licence, decided by code", () => {
  it("relabels public domain, CC0, CC BY and CC BY-SA images", () => {
    expect(imageLicence(info(["Public domain"]), FILE_URL)).toEqual({
      ok: true,
      spdx: "LicenseRef-PublicDomain",
      name: "Public domain",
      url: null,
      adapt: true,
    });
    expect(imageLicence(info(["CC0"]), FILE_URL)).toMatchObject({ spdx: "CC0-1.0", adapt: true });
    expect(imageLicence(info(["CC BY 4.0"]), FILE_URL)).toMatchObject({ adapt: true });
    expect(imageLicence(info(["CC BY-SA 2.5"]), FILE_URL)).toEqual({
      ok: true,
      spdx: "CC-BY-SA-2.5",
      name: "CC BY-SA 2.5",
      url: "https://creativecommons.org/licenses/by-sa/2.5/",
      adapt: true,
    });
  });

  it("shows an ND or NC image without relabelling it", () => {
    expect(imageLicence(info(["CC BY-ND 4.0"]), FILE_URL)).toMatchObject({
      ok: true,
      adapt: false,
    });
    expect(imageLicence(info(["CC BY-NC-SA 3.0"]), FILE_URL)).toMatchObject({
      ok: true,
      adapt: false,
    });
  });

  it("cites the most restrictive of several licences", () => {
    expect(imageLicence(info(["CC BY 2.5", "CC BY-SA 3.0"]), FILE_URL)).toMatchObject({
      spdx: "CC-BY-SA-3.0",
    });
    expect(imageLicence(info(["CC BY-SA 4.0", "CC BY-NC 4.0"]), FILE_URL)).toMatchObject({
      spdx: "CC-BY-NC-4.0",
      adapt: false,
    });
  });

  it("refuses an image when any licence is off the allowlist, none is stated, or CC BY names no author", () => {
    expect(imageLicence(info(["MPL 2", "LGPL"]), FILE_URL)).toMatchObject({ ok: false });
    expect(imageLicence(info(["GFDL", "CC BY-SA 3.0"]), FILE_URL)).toMatchObject({ ok: false });
    expect(imageLicence(info(["Fair use"]), FILE_URL)).toMatchObject({ ok: false });
    expect(imageLicence(info([]), FILE_URL)).toMatchObject({ ok: false });
    expect(imageLicence(info(["CC BY-SA 4.0"], null), FILE_URL)).toMatchObject({ ok: false });
  });
});
