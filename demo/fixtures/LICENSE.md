# Fixture licences

The repository's code licence is not chosen yet (#39). Whichever licence it is, it does not cover the recorded fixtures in `pages/` and `responses/`. Each fixture keeps the licence of its source.

These fixtures exist only so the demo runs without network access or a model key. Replay mode reads web pages and model replies from them instead of fetching them.

[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) lists each source with its licence, its authors and the licence statement on the page. `pnpm notices` writes that file from these fixtures.

## Recorded model calls

Each file in `responses/` holds one request to the Meta Model API and the model's reply.

- Calls that carry the text of a CC BY-SA page are licensed [CC BY-SA 4.0](https://spdx.org/licenses/CC-BY-SA-4.0.html). Their requests hold text from Wikipedia, in English, French and Russian, and from Wikibooks, in English and Russian. The model wrote lessons, quizzes and answer checks from that text. Credit goes to the authors of those pages. "Recorded model replies" in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) names each of these files and the pages it carries.
- No recorded call carries the text of the CC BY-NC-SA page or the MPL-2.0 page listed below. The scout's search calls name both by title and link, with one sentence on what each page teaches, and one recorded course plan lists the CC BY-NC-SA page as a resource.
- The other calls carry no third-party text, so no source licence applies to them.

## Recorded pages

Each file in `pages/` holds what the page fetcher read from one URL: a page's text or HTML, an image, a redirect or a failed fetch.

- `pages/biz.libretexts.org-b9f4e01f9ca71aa3.json` holds "7.2: PivotTables for Data Analysis" by Gabrielle Brixey, Coalinga College, via LibreTexts. It is licensed [CC BY-NC-SA 4.0](https://spdx.org/licenses/CC-BY-NC-SA-4.0.html). NonCommercial means no commercial reuse.
- `pages/help.libreoffice.org-dd5a6520fa8b559f.json` holds "数据透视表", the pivot table page of LibreOffice Help in Chinese. It is licensed [MPL-2.0](https://spdx.org/licenses/MPL-2.0.html).
- Every other page keeps the licence that [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) gives it. These are one [CC BY 4.0](https://spdx.org/licenses/CC-BY-4.0.html) LibreTexts page, [CC BY-SA 4.0](https://spdx.org/licenses/CC-BY-SA-4.0.html) pages from Wikipedia and Wikibooks, and two public-domain images from Wikimedia Commons. Commons shares the text of their file pages under CC BY-SA. The robots.txt files and redirects hold no page text.

## Other files

`prune.ts` is code, and `omar.json` is the demo's seeded learner, written for this project. The repository's licence covers both once #39 picks it.
