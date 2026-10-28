// The scout's ranker (#17): relevance, level fit and licence give each resource a score, and a
// greedy pick spreads the top resources across source languages.

import type { Resource } from "../../../../contracts/index.ts";

export type Rankable = {
  url: string;
  lang: Resource["lang"];
  relevance: number;
  level_fit: number;
  use: Resource["licence"]["use"];
};

const WEIGHTS = { relevance: 0.5, level_fit: 0.3, licence: 0.2 };
const LICENCE_VALUE: Record<Rankable["use"], number> = { open: 1, personal_study: 0.5 };
// Taken off a resource's score for each resource already picked in its language.
const SAME_LANGUAGE_PENALTY = 0.15;

const scoreOf = (r: Rankable) =>
  WEIGHTS.relevance * r.relevance +
  WEIGHTS.level_fit * r.level_fit +
  WEIGHTS.licence * LICENCE_VALUE[r.use];

// Returns up to `max` items in pick order. `score` is the item's own score, 0 to 1, before the
// language penalty.
export function rank<T extends Rankable>(items: T[], max: number): { item: T; score: number }[] {
  const left = items.map((item) => ({ item, score: Math.round(scoreOf(item) * 100) / 100 }));
  const picked: typeof left = [];
  const perLang = new Map<Rankable["lang"], number>();
  const adjusted = (c: (typeof left)[number]) =>
    c.score - SAME_LANGUAGE_PENALTY * (perLang.get(c.item.lang) ?? 0);

  while (picked.length < max && left.length) {
    const best = left.reduce((top, c) => (adjusted(c) > adjusted(top) ? c : top));
    left.splice(left.indexOf(best), 1);
    picked.push(best);
    perLang.set(best.item.lang, (perLang.get(best.item.lang) ?? 0) + 1);
  }
  return picked;
}
