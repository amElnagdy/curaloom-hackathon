import { describe, expect, it } from "vitest";
import { type Rankable, rank } from "./rank.ts";

const item = (url: string, over: Partial<Rankable> = {}): Rankable => ({
  url,
  lang: "en",
  relevance: 0.8,
  level_fit: 0.8,
  use: "open",
  ...over,
});
const urls = (ranked: { item: Rankable }[]) => ranked.map((r) => r.item.url);

describe("rank", () => {
  it("puts the more relevant resource first", () => {
    const ranked = rank([item("a", { relevance: 0.5 }), item("b", { relevance: 0.9 })], 8);

    expect(urls(ranked)).toEqual(["b", "a"]);
  });

  it("breaks a relevance tie by level fit", () => {
    const ranked = rank([item("a", { level_fit: 0.3 }), item("b", { level_fit: 0.9 })], 8);

    expect(urls(ranked)).toEqual(["b", "a"]);
  });

  it("prefers an open licence to a personal-study one", () => {
    const ranked = rank([item("nc", { use: "personal_study" }), item("by")], 8);

    expect(urls(ranked)).toEqual(["by", "nc"]);
  });

  it("lets a slightly weaker resource in another language beat a third in the same language", () => {
    const ranked = rank(
      [
        item("en1", { relevance: 0.9 }),
        item("en2", { relevance: 0.88 }),
        item("en3", { relevance: 0.86 }),
        item("ru1", { lang: "ru", relevance: 0.8 }),
      ],
      3,
    );

    expect(urls(ranked)).toEqual(["en1", "ru1", "en2"]);
  });

  it("keeps a far more relevant resource over language diversity", () => {
    const ranked = rank(
      [
        item("en1", { relevance: 1 }),
        item("en2", { relevance: 1 }),
        item("ru1", { lang: "ru", relevance: 0.1, level_fit: 0.1 }),
      ],
      2,
    );

    expect(urls(ranked)).toEqual(["en1", "en2"]);
  });

  it("returns at most `max` resources, each scored 0 to 1 on its own merits", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`r${i}`, { relevance: i / 10 }));

    const ranked = rank(items, 8);

    expect(ranked).toHaveLength(8);
    expect(ranked.map((r) => r.score)).toEqual(
      ranked.map((r) => r.score).toSorted((a, b) => b - a),
    );
    expect(rank([item("top", { relevance: 1, level_fit: 1 })], 8)[0]?.score).toBe(1);
    expect(
      rank([item("low", { relevance: 0, level_fit: 0, use: "personal_study" })], 8)[0]?.score,
    ).toBe(0.1);
  });
});
