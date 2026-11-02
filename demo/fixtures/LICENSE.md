# Fixture licences

The repository's code licence, Apache-2.0, does not cover the recorded fixtures in `pages/` and `responses/`. Each fixture keeps the licence of its source.

These fixtures exist only so the demo runs without network access or a model key. Replay mode reads web pages and model replies from them instead of fetching them.

[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) lists each source with its licence, its authors and the licence statement on the page. `pnpm notices` writes that file from these fixtures.

## Recorded model calls

Each file in `responses/` holds one request to the Meta Model API and the model's reply.

- Calls that carry the text of a CC BY-SA page adapt it, and are shared under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as [`LICENSE-CONTENT.md`](../../LICENSE-CONTENT.md) explains. Their requests hold text from Wikipedia, in English, French and Russian, and from Wikibooks, in English and Russian. The model wrote lessons, quizzes and answer checks from that text. Credit goes to the authors of those pages. [`ATTRIBUTION.md`](../../ATTRIBUTION.md) credits each page and names each of these files with the pages it carries.
- No recorded call carries the text of the CC BY-NC-SA page or of the two MPL-2.0 pages listed below. The scout's search calls name them by title and link, with one sentence on what each page teaches, and one recorded course plan lists the CC BY-NC-SA page as a resource. The intermediate and advanced recordings (#98) never name the CC BY-NC-SA page. One web-search reply and its candidates call name the new MPL-2.0 page «创建数据透视表» by title and link, and no #98 recording carries the text of any of these pages.
- The other calls carry no text from a recorded page, so no page licence applies to them. Some hold other third-party material. The image calls carry the two public-domain Commons images and Muse Image's relabelled copies, and the web-search replies list page titles and links. "Recorded images" in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) credits the images.

## Recorded pages

Each file in `pages/` holds what the page fetcher read from one URL. That is a page's text or HTML, an image, a redirect or a failed fetch.

- `pages/biz.libretexts.org-b9f4e01f9ca71aa3.json` holds "7.2: PivotTables for Data Analysis" by Gabrielle Brixey, Coalinga College, via LibreTexts. It is licensed [CC BY-NC-SA 4.0](https://spdx.org/licenses/CC-BY-NC-SA-4.0.html). NonCommercial means no commercial reuse. [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) gives its authors and licence statement.
- `pages/help.libreoffice.org-dd5a6520fa8b559f.json` holds "数据透视表", the pivot table page of LibreOffice Help in Chinese, and `pages/help.libreoffice.org-22d14c88dab83348.json` holds "创建数据透视表", its page on creating a pivot table. Both are licensed [MPL-2.0](https://spdx.org/licenses/MPL-2.0.html). The scout rejects them, and replay reads them to reach that rejection. [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) gives their licence statements.
- Every other page keeps the licence that [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) gives it. These are one [CC BY 4.0](https://spdx.org/licenses/CC-BY-4.0.html) LibreTexts page, [CC BY-SA 4.0](https://spdx.org/licenses/CC-BY-SA-4.0.html) pages from Wikipedia, Wikibooks and Wikiversity, and two public-domain images from Wikimedia Commons. Commons shares the text of their file pages under CC BY-SA. The folder also holds the file pages, without the images, of three images the diagrams agent skips for their licences (fair use, GFDL and MPL 2). The robots.txt files, the redirects and the fetches that were refused or returned no text hold no page text.

## Other files

`prune.ts` is code, and `omar.json` is the demo's seeded learner, written for this project. The repository's Apache-2.0 licence covers both.
