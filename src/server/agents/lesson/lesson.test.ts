import { describe, expect, it } from "vitest";
import type { Resource } from "../../../../contracts/index.ts";
import type { FetchOutcome } from "../../tools/fetch-page.ts";
import { quotableText } from "./lesson.ts";

const URL = "https://fr.wikipedia.org/wiki/Tableur";
const VERIFIED: Resource["licence"] = {
  spdx: "CC-BY-SA-4.0",
  use: "open",
  evidence_url: URL,
  quote: "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License.",
  verified: true,
};

const fetched = (text: string, truncated = false): FetchOutcome => ({
  ok: true,
  page: { url: URL, final_url: URL, status: 200, content_type: "text/html", truncated, text },
});
const ARTICLE = "Un tableur est un programme informatique qui manipule des feuilles de calcul.";
const LICENCE = "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License.";

// The scout checked the licence when it found the page; the lesson builder reads the page again
// later, so it quotes only a page that still carries that licence.
describe("quotableText", () => {
  it("gives the page text while the page still carries the licence the scout verified", () => {
    const text = `${ARTICLE} ${LICENCE}`;

    expect(quotableText(VERIFIED, fetched(text))).toEqual({ ok: true, text });
  });

  it.each([
    [
      "now under another licence",
      fetched(
        `${ARTICLE} Text is available under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 License.`,
      ),
    ],
    [
      "now saying all rights reserved",
      fetched(`${ARTICLE} ${LICENCE} © 2026 Example Corp. All rights reserved.`),
    ],
    [
      "now limiting reuse elsewhere on it",
      fetched(`${ARTICLE} ${LICENCE} Some tools are free for non-commercial use only.`),
    ],
    ["no longer naming a licence", fetched(ARTICLE)],
  ])("has nothing to quote from a page %s", (_, outcome) => {
    expect(quotableText(VERIFIED, outcome)).toEqual({ ok: false, why: "licence" });
  });

  it.each([
    ["too long to read to its end", fetched(`${ARTICLE} ${LICENCE}`, true)],
    ["that could not be read", { ok: false, url: URL, reason: "HTTP 503" } as FetchOutcome],
    ["with no text", fetched("")],
  ])("has nothing to quote from a page %s, which it did not read in full", (_, outcome) => {
    expect(quotableText(VERIFIED, outcome)).toEqual({ ok: false, why: "unread" });
  });
});
