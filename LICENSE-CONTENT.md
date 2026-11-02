# Content licence

The code in this repository is licensed under the Apache License 2.0 ([`LICENSE`](LICENSE)). Some of the content is adapted from sources licensed CC BY-SA. As the ShareAlike term of those sources requires, that content is shared under the [Creative Commons Attribution-ShareAlike 4.0 International licence](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0), whose full text is at https://creativecommons.org/licenses/by-sa/4.0/legalcode. The Apache License does not cover this content, and CC BY-SA 4.0 does not cover the code.

## What CC BY-SA 4.0 covers

- **The recorded model calls that adapt a CC BY-SA source.** These are the files in `demo/fixtures/responses/` that [`ATTRIBUTION.md`](ATTRIBUTION.md) lists under "Recordings that adapt them". Each request quotes text from a CC BY-SA page, and the model wrote Arabic lessons, quizzes or answer-key checks from it. The licence covers the whole file, request and reply.
- **The lessons and quizzes the replay demo shows from those recordings.** `pnpm demo:replay` and `pnpm preview` show the excerpts and the Arabic text built on them.
- **What the demo GIF shows of them.** `docs/media/demo.gif` shows excerpts of the Wikipedia articles «Tableur», «Сводная таблица» and "Pivot table", and the Arabic lesson and quiz written from them.
- **Lessons the app writes from a CC BY-SA source when it runs live.** Such a lesson adapts its source and carries the ShareAlike licence that the lesson page's sources panel names, which may be another version of CC BY-SA.

## Attribution and changes

[`ATTRIBUTION.md`](ATTRIBUTION.md) credits each CC BY-SA source with its title, authors, link, licence and version, and says whether the recordings adapt it. `pnpm notices` writes that file from the recordings, and CI fails when the committed file is out of date. On a lesson page, the sources panel gives each source's title, link and licence, with a button that copies a credit line.

The Arabic explanations are not translations. The model wrote them from the quoted excerpts. It shortened, reordered and added examples. The excerpts themselves are quoted as their sources write them, without the text in square brackets, such as footnote numbers and editors' notes.

## What it does not cover

- **The code, docs and configuration.** The Apache License 2.0 covers them, except the excerpts, lessons and quizzes that `docs/media/demo.gif` shows.
- **The recorded pages in `demo/fixtures/pages/`.** They are copies, not adaptations, and each keeps its own licence. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) gives each one.
- **The other recorded calls in `demo/fixtures/responses/`.** They carry no text from a CC BY-SA page. [`demo/fixtures/LICENSE.md`](demo/fixtures/LICENSE.md) explains what they hold.
