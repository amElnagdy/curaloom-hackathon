// The scout (#17) finds open-licence learning resources for the learner's topic in the source
// languages the learner accepts. A model writes the search queries, searches the web and describes
// the pages it cited; code then fetches each page, decides its licence and ranks the pages that
// pass. The model sees only the topic, goal, level and languages, and never decides a licence.

import { createHash } from "node:crypto";
import {
  Candidates,
  type LearnerProfile,
  type Rejection,
  type Resource,
  ScoutQueries,
  ScoutResult,
  validate,
} from "../../../../contracts/index.ts";
import {
  type Agent,
  type AgentContext,
  type createOrchestrator,
  withFeedback,
} from "../../orchestrator/orchestrator.ts";
import type { Citation } from "../../providers/provider.ts";
import { type Cache, contentHash } from "../../store/store.ts";
import type { PageFetcher } from "../../tools/fetch-page.ts";
import { classifyLicence, type LicenceCheck } from "./licence.ts";
import { rank } from "./rank.ts";

type Lang = Resource["lang"];
type Candidate = Candidates["candidates"][number];

// All the scout knows about the learner. It has no name or contact field, so neither can reach a
// prompt.
export type ScoutBrief = {
  topic: string;
  goal: string;
  level: LearnerProfile["diagnostic"]["level"];
  langs: Lang[];
};

// The scout searches the source languages the learner's profile accepts, in the profile's order.
export function scoutBrief(profile: LearnerProfile): ScoutBrief {
  const langs = [...new Set(profile.source_langs_ok)];
  if (!langs.length) throw new Error("The learner's profile accepts no source language to search");
  return { topic: profile.topic, goal: profile.goal, level: profile.diagnostic.level, langs };
}

export type ScoutRun = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  sessionId: string;
  brief: ScoutBrief;
  pages: PageFetcher;
  // Outlives every session: it keeps each result and each paid search under data/cache/scout.
  cache: Cache;
};

// The topic and the sorted languages name a result, both as the step key in the session and in the
// cache, so a second run with the same pair returns it without a model call, in any session.
export function runScout({
  orchestrator,
  sessionId,
  brief,
  pages,
  cache,
}: ScoutRun): Promise<ScoutResult> {
  const key = contentHash([brief.topic, [...brief.langs].sort()]);
  const agent = scoutAgent(pages, cache, `result_${key}`);
  return orchestrator.runStep(sessionId, agent, brief, { key: `scout:${key}` });
}

const CACHE_AREA = "scout";
const MAX_RESOURCES = 8;
// Fewer passing resources than this after the first round buy one extra round.
const TARGET_RESOURCES = 5;
// The extra round searches again in at most this many languages, so it costs at most half of a
// first round in four languages.
const EXTRA_ROUND_LANGS = 2;
const MAX_QUERIES = 2;
const FETCH_CONCURRENCY = 4;

const LANGUAGE: Record<Lang, { en: string; ar: string }> = {
  en: { en: "English", ar: "بالإنجليزية" },
  ru: { en: "Russian", ar: "بالروسية" },
  zh: { en: "Chinese", ar: "بالصينية" },
  fr: { en: "French", ar: "بالفرنسية" },
};

const QUERIES_INSTRUCTIONS =
  "You plan web searches for free, openly licensed learning resources. For each language listed, write two short search queries in that language that find pages teaching the topic at the learner's level, from open sources such as Wikipedia, Wikibooks, Wikiversity, open textbooks and open courseware. Give each language once, by its code.";

const BROADER_QUERIES_INSTRUCTIONS =
  "You plan web searches for free, openly licensed learning resources. The queries already tried found too few openly licensed pages. For each language listed, write two broader search queries in that language: the wider subject the topic belongs to, or another name for it, still at the learner's level, from open sources such as Wikipedia, Wikibooks, Wikiversity, open textbooks and open courseware. Do not repeat a query already tried. Give each language once, by its code.";

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
type Accepted = Extract<Checked, { ok: true }>;
type Planned = { lang: Lang; queries: string[] };
type Summary = { summary_ar: string; summary_en: string };
// What the rounds of one run found so far. `seen` holds every page URL a round kept or rejected,
// normalised, so a later round neither checks nor rejects one again.
type Pool = { seen: Set<string>; accepted: Accepted[]; rejected: Rejection[] };

// What every part of one run reads: the orchestrator's context, the brief and the scout's tools.
type ScoutContext = AgentContext & { brief: ScoutBrief; pages: PageFetcher; cache: Cache };

function scoutAgent(
  pages: PageFetcher,
  cache: Cache,
  resultKey: string,
): Agent<ScoutBrief, typeof ScoutResult> {
  return {
    name: "scout",
    output: ScoutResult,
    async run(agentCtx, brief) {
      const saved = cache.read<ScoutResult>(CACHE_AREA, resultKey);
      if (saved) {
        agentCtx.trace({
          kind: "decision",
          summary_ar: "وجد نتيجة سابقة لهذا الموضوع بهذه اللغات، فلم يبحث من جديد",
          summary_en: `Scout result read from the cache (${CACHE_AREA}/${resultKey}); no search and no model call`,
        });
        return saved;
      }
      const ctx: ScoutContext = { ...agentCtx, brief, pages, cache };
      const costBefore = ctx.provider.totalCostUsd();
      const pool: Pool = { seen: new Set(), accepted: [], rejected: [] };
      const planned = await planQueries(ctx, brief.langs);
      await scoutRound(ctx, planned, pool);

      // Short of the target: one more round, with broader queries, for the languages that yielded
      // least. Then the scout stops, whatever that round finds.
      if (pool.accepted.length < TARGET_RESOURCES) {
        const langs = leastYield(brief.langs, pool.accepted).slice(0, EXTRA_ROUND_LANGS);
        const passed = pool.accepted.length;
        ctx.trace({
          kind: "decision",
          summary_ar: `اجتاز ${passed} من ${TARGET_RESOURCES} مصادر مطلوبة، فيبحث مرة أخرى بعبارات أوسع ${langs.map((l) => LANGUAGE[l].ar).join(" و")}`,
          summary_en: `Only ${passed} of the ${TARGET_RESOURCES} resources aimed for passed; one more round with broader queries for ${langs.join(", ")}`,
        });
        await scoutRound(ctx, await planQueries(ctx, langs, planned), pool);
      }

      const ranked = rank(
        pool.accepted.map(({ candidate, check }) => ({ ...candidate, use: check.use, check })),
        MAX_RESOURCES,
      );
      const { rejected } = pool;
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

      // The trace has no warning kind; the activity feed shows a non-step error as a warning.
      if (resources.length && resources.length < TARGET_RESOURCES) {
        ctx.trace({
          kind: "error",
          summary_ar: `لم يجد إلا ${resources.length} من ${TARGET_RESOURCES} مصادر مطلوبة بعد بحث إضافي، فيكتفي بها`,
          summary_en: `Warning: only ${resources.length} of the ${TARGET_RESOURCES} resources aimed for passed after the extra round; returning them`,
        });
      }
      const perLang = brief.langs
        .map((lang) => `${lang} ${resources.filter((r) => r.lang === lang).length}`)
        .join(", ");
      const cost = ctx.provider.totalCostUsd() - costBefore;
      ctx.trace({
        kind: "decision",
        summary_ar: `انتهى البحث عن المصادر: المختارة ${resources.length}، والمستبعدة ${rejected.length}`,
        summary_en: `Scout chose ${resources.length} resources (${perLang}) and rejected ${rejected.length}; run cost $${cost.toFixed(4)} in total`,
      });
      // Only a result that meets the contract is kept: none passed means the step fails.
      if (!resources.length) throw new Error(`No cited page passed the checks (${perLang})`);
      const result = { resources, rejected };
      cache.write(CACHE_AREA, resultKey, result);
      return result;
    },
  };
}

// Asks for a paid answer once. It is kept under a hash of the request, so a later run, or the
// orchestrator's retry of this step, reads it instead of paying again. Only what `call` returns is
// kept, after its validation, so a reply that broke its contract never is.
async function paidOnce<T>(
  ctx: ScoutContext,
  request: { kind: "plan" | "search"; material: unknown[]; hit: Summary },
  call: () => Promise<T>,
): Promise<T> {
  const key = `${request.kind}_${contentHash(request.material)}`;
  const kept = ctx.cache.read<T>(CACHE_AREA, key);
  if (kept !== undefined) {
    ctx.trace({ kind: "decision", ...request.hit });
    return kept;
  }
  const answer = await call();
  ctx.cache.write(CACHE_AREA, key, answer);
  return answer;
}

// Has the model write queries for `langs`; given the queries already `tried`, broader ones.
async function planQueries(
  ctx: ScoutContext,
  langs: Lang[],
  tried?: Planned[],
): Promise<Planned[]> {
  const { brief } = ctx;
  const instructions = tried ? BROADER_QUERIES_INSTRUCTIONS : QUERIES_INSTRUCTIONS;
  const triedLines = (tried ?? [])
    .filter((t) => langs.includes(t.lang))
    .map((t) => `${t.lang}: ${t.queries.join("; ")}`);
  const input = [
    learnerLines(brief),
    `Languages: ${langs.join(", ")}`,
    ...(tried ? ["Queries already tried:", ...triedLines] : []),
  ].join("\n");
  const hit = {
    summary_ar: "يستعمل عبارات البحث التي صاغها من قبل لهذا الطلب",
    summary_en: `Queries read from the cache for ${langs.join(", ")}`,
  };
  const plan = await paidOnce(
    ctx,
    { kind: "plan", material: [instructions, input], hit },
    async () => {
      const result = await ctx.provider.structured({
        role: "agent_default",
        trace: {
          agent: "scout",
          summary_ar: tried
            ? "يصوغ عبارات بحث أوسع للغات التي وجد فيها أقل"
            : "يصوغ عبارات بحث بكل لغة من لغات المصادر",
          summary_en: `Writing ${tried ? "broader " : ""}search queries for ${langs.join(", ")}`,
        },
        instructions,
        input: withFeedback(ctx, input),
        schema: { name: "ScoutQueries", schema: ScoutQueries },
      });
      return validate(ScoutQueries, result.json);
    },
  );
  return langs.map((lang) => {
    const written = plan.queries
      .filter((q) => q.lang === lang)
      .flatMap((q) => q.queries)
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, MAX_QUERIES);
    const queries = written.length ? written : [brief.topic];
    ctx.trace({
      kind: "decision",
      summary_ar: `صاغ عبارات بحث ${LANGUAGE[lang].ar}: ${queries.join("، ")}`,
      summary_en: `Queries (${lang}): ${queries.map((q) => JSON.stringify(q)).join(", ")}`,
    });
    return { lang, queries };
  });
}

// One round: searches each planned language and checks each page no earlier round saw. A page that
// any language kept is checked, even if another language left it out. Every rejection is traced.
async function scoutRound(ctx: ScoutContext, planned: Planned[], pool: Pool): Promise<void> {
  const found = await settleAll(
    planned.map(({ lang, queries }) => searchLanguage(ctx, lang, queries)),
  );
  const unseen = (url: string) => {
    const key = normalUrl(url);
    if (pool.seen.has(key)) return false;
    pool.seen.add(key);
    return true;
  };
  const candidates = found.flatMap((f) => f.cited).filter((c) => unseen(c.url));
  const dropped = found.flatMap((f) => f.dropped).filter((r) => unseen(r.url));

  const checked = await mapPool(candidates, FETCH_CONCURRENCY, (c) => checkPage(ctx, c));
  const rejected = [...dropped, ...checked.flatMap((c) => (c.ok ? [] : [c.rejection]))];
  for (const r of rejected) {
    ctx.trace({
      kind: "decision",
      summary_ar: `استبعد مصدرًا من ${hostOf(r.url)}: ${r.reason_ar}`,
      summary_en: `Rejected ${r.url}: ${r.reason}`,
    });
  }
  pool.accepted.push(...checked.flatMap((c) => (c.ok ? [c] : [])));
  pool.rejected.push(...rejected);
}

// The brief's languages, those with the fewest passing pages first; a tie keeps the brief's order.
const leastYield = (langs: Lang[], accepted: Accepted[]) =>
  langs
    .map((lang) => ({ lang, passed: accepted.filter((a) => a.candidate.lang === lang).length }))
    .toSorted((a, b) => a.passed - b.passed)
    .map(({ lang }) => lang);

// Searches in one language and has the model describe what the search cited. A candidate whose URL
// the search never cited is dropped, as a page the search did not open is not evidence of anything,
// and so is a cited page the model left out; each gets a reason.
async function searchLanguage(
  ctx: ScoutContext,
  lang: Lang,
  queries: string[],
): Promise<{ cited: Candidate[]; dropped: Rejection[] }> {
  const { brief } = ctx;
  const input = `Language: ${LANGUAGE[lang].en}\n${learnerLines(brief)}\nSearch queries to try: ${queries.join("; ")}`;
  const hit = {
    summary_ar: `يستعمل نتيجة بحث سابقة ${LANGUAGE[lang].ar}`,
    summary_en: `web_search (${lang}) read from the cache: ${queries.join(" | ")}`,
  };
  const search = await paidOnce(
    ctx,
    { kind: "search", material: [SEARCH_INSTRUCTIONS, input], hit },
    async () => {
      const { text, citations } = await ctx.provider.webSearch({
        role: "agent_default",
        trace: {
          agent: "scout",
          summary_ar: `يبحث في الويب عن مصادر ${LANGUAGE[lang].ar}`,
          summary_en: `web_search (${lang}): ${queries.join(" | ")}`,
        },
        instructions: SEARCH_INSTRUCTIONS,
        input,
      });
      return { text, citations };
    },
  );
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
    input: withFeedback(
      ctx,
      `${learnerLines(brief)}\nLanguage searched: ${lang}\n\nSearch answer:\n${search.text}\n\nCited pages:\n${citedList(search.citations)}`,
    ),
    schema: { name: "Candidates", schema: Candidates },
  });
  const { candidates } = validate(Candidates, described.json);

  const byUrl = new Map(search.citations.map((c) => [normalUrl(c.url), c]));
  const kept = new Set<string>();
  const cited: Candidate[] = [];
  const dropped: Rejection[] = [];
  for (const candidate of candidates) {
    const key = normalUrl(candidate.url);
    const citation = byUrl.get(key);
    if (!citation) {
      dropped.push(
        rejection(
          candidate,
          "not among the pages the search cited",
          "لم يرد بين الصفحات التي استشهد بها البحث",
        ),
      );
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
    dropped.push(
      rejection(
        { url, title, lang },
        "the model judged it off the topic",
        "رأى النموذج أنه لا يتناول الموضوع",
      ),
    );
  }
  return { cited, dropped };
}

const rejection = (
  { url, title, lang }: Pick<Rejection, "url" | "title" | "lang">,
  reason: string,
  reason_ar: string,
): Rejection => ({ url, title, lang, reason, reason_ar });

async function checkPage(ctx: ScoutContext, candidate: Candidate): Promise<Checked> {
  const reject = (reason: string, reason_ar: string): Checked => ({
    ok: false,
    rejection: rejection(candidate, reason, reason_ar),
  });
  const fetched = await ctx.pages.fetchPage(candidate.url, ctx.trace);
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

// Like Promise.all, but fails only once every call has ended, so each paid search that did finish
// is in the cache before the orchestrator retries.
async function settleAll<T>(work: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  const failed = settled.flatMap((s) => (s.status === "rejected" ? [s.reason] : []));
  if (failed.length) {
    throw new Error(failed.map((e) => (e instanceof Error ? e.message : String(e))).join("; "));
  }
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value);
}

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
