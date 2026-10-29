// The scout (#17) finds open-licence learning resources for the learner's topic in up to four
// languages. A model writes the search queries, searches the web and describes the pages it cited;
// code then fetches each page, decides its licence and ranks the pages that pass. The model sees
// only the topic, goal, level and languages, and never decides a licence.

import { createHash } from "node:crypto";
import Type, { type Static, type TSchema } from "typebox";
import { type LearnerProfile, Resource, SOURCE_LANGS } from "../../../../contracts/index.ts";
import type { Agent, AgentContext, createOrchestrator } from "../../orchestrator/orchestrator.ts";
import type { Citation } from "../../providers/provider.ts";
import type { PageFetcher } from "../../tools/fetch-page.ts";
import { classifyLicence, type LicenceCheck } from "./licence.ts";
import { rank } from "./rank.ts";

type Lang = Resource["lang"];

const Obj = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
const SourceLang = Resource.properties.lang;

export const ScoutQueries = Obj({
  queries: Type.Array(
    Obj({
      lang: SourceLang,
      queries: Type.Array(Type.String(), {
        description: "two short web search queries, written in that language",
      }),
    }),
  ),
});

// What the model says about a page it cited. Licence fields are absent on purpose: code decides.
export const Candidates = Obj({
  candidates: Type.Array(
    Obj({
      url: Type.String({ description: "one of the cited page URLs, copied exactly" }),
      title: Type.String(),
      lang: SourceLang,
      type: Resource.properties.type,
      why_ar: Type.String({
        description: "one Arabic sentence on why this page suits the learner",
      }),
      relevance: Type.Number({ description: "how closely the page teaches the topic, 0 to 1" }),
      level_fit: Type.Number({
        description: "how well the page suits the learner's level, 0 to 1",
      }),
    }),
  ),
});
type Candidate = Static<typeof Candidates>["candidates"][number];

const Rejection = Obj({
  url: Type.String(),
  title: Type.String(),
  lang: SourceLang,
  reason: Type.String(),
  reason_ar: Type.String(),
});
type Rejection = Static<typeof Rejection>;

export const ScoutResult = Obj({
  resources: Type.Array(Resource, { minItems: 1, maxItems: 8 }),
  rejected: Type.Array(Rejection),
});
export type ScoutResult = Static<typeof ScoutResult>;

// All the scout knows about the learner. It has no name or contact field, so neither can reach a
// prompt.
export type ScoutBrief = {
  topic: string;
  goal: string;
  level: LearnerProfile["diagnostic"]["level"];
  langs: Lang[];
};

// `source_langs_ok` lists what the learner reads; lessons are written in Arabic, so the scout
// searches every source language unless told otherwise.
export function scoutBrief(
  profile: LearnerProfile,
  langs: readonly Lang[] = SOURCE_LANGS,
): ScoutBrief {
  return {
    topic: profile.topic,
    goal: profile.goal,
    level: profile.diagnostic.level,
    langs: [...langs],
  };
}

export type ScoutRun = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  sessionId: string;
  brief: ScoutBrief;
  pages: PageFetcher;
};

// The step key names the topic and the languages, so the session keeps one result per pair and a
// second run with the same pair returns it without a model call.
export function runScout({
  orchestrator,
  sessionId,
  brief,
  pages,
}: ScoutRun): Promise<ScoutResult> {
  const material = JSON.stringify([brief.topic, [...brief.langs].sort()]);
  const key = `scout:${createHash("sha256").update(material).digest("hex").slice(0, 12)}`;
  return orchestrator.runStep(sessionId, scoutAgent(pages), brief, { key });
}

const MAX_RESOURCES = 8;
const MAX_QUERIES = 3;
const FETCH_CONCURRENCY = 4;

const LANGUAGE: Record<Lang, { en: string; ar: string }> = {
  en: { en: "English", ar: "بالإنجليزية" },
  ru: { en: "Russian", ar: "بالروسية" },
  zh: { en: "Chinese", ar: "بالصينية" },
  fr: { en: "French", ar: "بالفرنسية" },
};

const QUERIES_INSTRUCTIONS =
  "You plan web searches for free, openly licensed learning resources. For each language listed, write two short search queries in that language that find pages teaching the topic at the learner's level, from open sources such as Wikipedia, Wikibooks, Wikiversity, open textbooks and open courseware. Give each language once, by its code.";

const SEARCH_INSTRUCTIONS =
  "You find free, openly licensed learning resources. Search the web at most 4 times, then open up to 6 promising pages written in the requested language. List only pages you opened, and cite each one with its URL. For each page give its title, its URL and one short sentence on what it teaches; do not summarise the page. Prefer sources that state an open licence on the page, such as Wikipedia, Wikibooks, Wikiversity, open textbooks, open courseware and open-source documentation. Skip vendor help pages and commercial course sites: their content is rarely openly licensed.";

const DESCRIBE_INSTRUCTIONS =
  "You describe learning resources that a web search cited. Return one candidate for each cited page that teaches the topic, and leave out pages that do not. Copy each url exactly from the cited pages. Give the language the page is written in. why_ar is one Arabic sentence telling the learner why this page suits them. relevance is how closely the page teaches the topic, and level_fit how well it suits the learner's level, each from 0 to 1.";

const learnerLines = (brief: ScoutBrief) =>
  `Topic: ${brief.topic}\nThe learner's goal: ${brief.goal}\nLevel: ${brief.level}`;

type Cleared = LicenceCheck & { use: Resource["licence"]["use"] };
type Checked =
  | { ok: true; candidate: Candidate; check: Cleared }
  | { ok: false; rejection: Rejection };

function scoutAgent(pages: PageFetcher): Agent<ScoutBrief, typeof ScoutResult> {
  return {
    name: "scout",
    output: ScoutResult,
    async run(ctx, brief) {
      const costBefore = ctx.provider.totalCostUsd();
      const queries = await planQueries(ctx, brief);
      const found = await Promise.all(
        brief.langs.map((lang) => searchLanguage(ctx, brief, lang, queries[lang])),
      );

      const seen = new Set<string>();
      const rejected: Rejection[] = [];
      const candidates: Candidate[] = [];
      for (const { cited, dropped } of found) {
        rejected.push(...dropped);
        for (const candidate of cited) {
          const key = normalUrl(candidate.url);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(candidate);
        }
      }

      const checked = await mapPool(candidates, FETCH_CONCURRENCY, (c) => checkPage(ctx, pages, c));
      const accepted = checked.flatMap((c) => (c.ok ? [c] : []));
      rejected.push(...checked.flatMap((c) => (c.ok ? [] : [c.rejection])));
      for (const r of rejected) {
        ctx.trace({
          kind: "decision",
          summary_ar: `استبعد مصدرًا من ${hostOf(r.url)}: ${r.reason_ar}`,
          summary_en: `Rejected ${r.url}: ${r.reason}`,
        });
      }

      const ranked = rank(
        accepted.map(({ candidate, check }) => ({ ...candidate, use: check.use, check })),
        MAX_RESOURCES,
      );
      const resources: Resource[] = ranked.map(({ item, score }) => ({
        id: `r_${createHash("sha256").update(item.url).digest("hex").slice(0, 8)}`,
        url: item.url,
        title: item.title,
        lang: item.lang,
        licence: {
          spdx: item.check.spdx,
          use: item.check.use,
          evidence_url: item.check.evidence_url,
          quote: item.check.quote,
          verified: true,
        },
        type: item.type,
        citations: [{ url: item.url }],
        score,
        why_ar: item.why_ar,
      }));

      const perLang = brief.langs
        .map((lang) => `${lang} ${resources.filter((r) => r.lang === lang).length}`)
        .join(", ");
      const cost = ctx.provider.totalCostUsd() - costBefore;
      ctx.trace({
        kind: "decision",
        summary_ar: `انتهى البحث عن المصادر: المختارة ${resources.length}، والمستبعدة ${rejected.length}`,
        summary_en: `Scout chose ${resources.length} resources (${perLang}) and rejected ${rejected.length}; run cost $${cost.toFixed(4)} in total`,
      });
      return { resources, rejected };
    },
  };
}

async function planQueries(ctx: AgentContext, brief: ScoutBrief): Promise<Record<Lang, string[]>> {
  const result = await ctx.provider.structured({
    role: "agent_default",
    trace: {
      agent: "scout",
      summary_ar: "يصوغ عبارات بحث بكل لغة من لغات المصادر",
      summary_en: `Writing search queries for ${brief.langs.join(", ")}`,
    },
    instructions: QUERIES_INSTRUCTIONS,
    input: `${learnerLines(brief)}\nLanguages: ${brief.langs.join(", ")}`,
    schema: { name: "ScoutQueries", schema: ScoutQueries },
  });
  const planned = {} as Record<Lang, string[]>;
  for (const lang of brief.langs) {
    const written = result.json.queries
      .filter((q) => q.lang === lang)
      .flatMap((q) => q.queries)
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, MAX_QUERIES);
    planned[lang] = written.length ? written : [brief.topic];
    ctx.trace({
      kind: "decision",
      summary_ar: `صاغ عبارات بحث ${LANGUAGE[lang].ar}: ${planned[lang].join("، ")}`,
      summary_en: `Queries (${lang}): ${planned[lang].map((q) => JSON.stringify(q)).join(", ")}`,
    });
  }
  return planned;
}

// Searches in one language and has the model describe what the search cited. A candidate whose URL
// the search never cited is dropped, as a page the search did not open is not evidence of anything,
// and so is a cited page the model left out; each gets a reason.
async function searchLanguage(
  ctx: AgentContext,
  brief: ScoutBrief,
  lang: Lang,
  queries: string[],
): Promise<{ cited: Candidate[]; dropped: Rejection[] }> {
  const search = await ctx.provider.webSearch({
    role: "agent_default",
    trace: {
      agent: "scout",
      summary_ar: `يبحث في الويب عن مصادر ${LANGUAGE[lang].ar}`,
      summary_en: `web_search (${lang}): ${queries.join(" | ")}`,
    },
    instructions: SEARCH_INSTRUCTIONS,
    input: `Language: ${LANGUAGE[lang].en}\n${learnerLines(brief)}\nSearch queries to try: ${queries.join("; ")}`,
  });
  if (!search.citations.length) {
    ctx.trace({
      kind: "decision",
      summary_ar: `لم يستشهد البحث ${LANGUAGE[lang].ar} بأي صفحة`,
      summary_en: `web_search (${lang}) cited no pages`,
    });
    return { cited: [], dropped: [] };
  }

  const described = await ctx.provider.structured({
    role: "agent_default",
    trace: {
      agent: "scout",
      summary_ar: `يقرأ ما وجده البحث ${LANGUAGE[lang].ar} ويصف كل صفحة`,
      summary_en: `Describing ${search.citations.length} cited pages (${lang})`,
    },
    instructions: DESCRIBE_INSTRUCTIONS,
    input: `${learnerLines(brief)}\nLanguage searched: ${lang}\n\nSearch answer:\n${search.text}\n\nCited pages:\n${citedList(search.citations)}`,
    schema: { name: "Candidates", schema: Candidates },
  });

  const byUrl = new Map(search.citations.map((c) => [normalUrl(c.url), c]));
  const kept = new Set<string>();
  const cited: Candidate[] = [];
  const dropped: Rejection[] = [];
  for (const candidate of described.json.candidates) {
    const key = normalUrl(candidate.url);
    const citation = byUrl.get(key);
    if (!citation) {
      dropped.push({
        url: candidate.url,
        title: candidate.title,
        lang: candidate.lang,
        reason: "not among the pages the search cited",
        reason_ar: "لم يرد بين الصفحات التي استشهد بها البحث",
      });
    } else if (!kept.has(key)) {
      kept.add(key);
      cited.push({
        ...candidate,
        url: citation.url,
        relevance: unit(candidate.relevance),
        level_fit: unit(candidate.level_fit),
      });
    }
  }
  for (const [key, { url, title }] of byUrl) {
    if (kept.has(key)) continue;
    dropped.push({
      url,
      title,
      lang,
      reason: "the model judged it off the topic",
      reason_ar: "رأى النموذج أنه لا يتناول الموضوع",
    });
  }
  return { cited, dropped };
}

async function checkPage(
  ctx: AgentContext,
  pages: PageFetcher,
  candidate: Candidate,
): Promise<Checked> {
  const reject = (reason: string, reason_ar: string): Checked => ({
    ok: false,
    rejection: {
      url: candidate.url,
      title: candidate.title,
      lang: candidate.lang,
      reason,
      reason_ar,
    },
  });
  const fetched = await pages.fetchPage(candidate.url, ctx.trace);
  if (!fetched.ok) return reject(`could not read the page: ${fetched.reason}`, "تعذّرت قراءة صفحته");
  // Terms past the byte cap were never read, so a cut page cannot be cleared.
  if (fetched.page.truncated) {
    return reject(
      "the page is longer than the fetcher reads, so its licence terms were not all read",
      "صفحته أطول من أن تُقرأ كاملة، فلم يُتحقق من كل شروط ترخيصها",
    );
  }
  const check = classifyLicence(fetched.page.text, fetched.page.final_url);
  if (check.use === "rejected") return reject(check.reason, check.reason_ar);
  ctx.trace({
    kind: "tool_call",
    summary_ar: `تحقّق من ترخيص صفحة من ${hostOf(candidate.url)}: ${check.spdx}${check.use === "personal_study" ? "، للدراسة الشخصية فقط" : ""}`,
    summary_en: `licence_check ${candidate.url}: ${check.spdx} (${check.use}), ${check.reason}`,
  });
  return { ok: true, candidate, check: { ...check, use: check.use } };
}

const citedList = (citations: Citation[]) =>
  citations.map((c, i) => `${i + 1}. ${c.url} | ${c.title}`).join("\n");

// The form two spellings of one URL share: parsed (which percent-encodes a written-out path), with
// no fragment and no trailing slash.
function normalUrl(url: string): string {
  const parsed = URL.parse(url.trim());
  if (!parsed) return url.trim();
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
}

const hostOf = (url: string) => URL.parse(url)?.host ?? url;

// Model scores are bounded by the prompt, not the schema.
const unit = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
