import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Resource, type ScoutQueries, SOURCE_LANGS } from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { createOrchestrator } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type ModelResult, type Provider } from "../../providers/provider.ts";
import { createFileCache, createFileStore } from "../../store/store.ts";
import { createPageFetcher, type FetchOutcome, type PageFetcher } from "../../tools/fetch-page.ts";
import type { TraceEvent } from "../../trace/trace.ts";
import { runScout, scoutBrief } from "./scout.ts";

type Lang = Resource["lang"];

const profile = loadOmarSeed("Pivot tables in spreadsheets").profile;

const WIKI = "https://en.wikipedia.org/wiki/Pivot_table";
const VENDOR = "https://vendor.example/pivot";
const HUGE = "https://big.example/pivot";
const INVENTED = "https://invented.example/pivot";
const OFF_TOPIC = "https://en.wikipedia.org/wiki/Contingency_table";
const BOOK = "https://ru.wikibooks.org/wiki/Сводные_таблицы";
const BOOK_CITED = encodeURI(BOOK);
const BLOCKED = "https://blocked.example/svodnye";

const page = (url: string, text: string, truncated = false): FetchOutcome => ({
  ok: true,
  page: { url, final_url: url, status: 200, content_type: "text/html", truncated, text },
});
const CC_BY_SA = "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License.";
const WEB: Record<string, FetchOutcome> = {
  [WIKI]: page(WIKI, `Pivot table. ${CC_BY_SA}`),
  [VENDOR]: page(VENDOR, "Pivot tables. © 2026 Vendor Inc. All rights reserved."),
  [HUGE]: page(HUGE, CC_BY_SA, true),
  [BOOK_CITED]: page(BOOK_CITED, "Сводные таблицы. Текст доступен по лицензии CC BY-NC 4.0."),
  [BLOCKED]: { ok: false, url: BLOCKED, reason: "robots.txt disallows it" },
};

// Per language: the query the model writes, the pages the search cites, and the URLs the model
// then describes (one invented, one left out, one a second spelling of a page another language
// found).
const SCRIPT: Record<"en" | "ru", { query: string; cited: string[]; described: string[] }> = {
  en: {
    query: "pivot table tutorial",
    cited: [WIKI, VENDOR, HUGE, OFF_TOPIC],
    described: [WIKI, VENDOR, HUGE, INVENTED],
  },
  ru: {
    query: "сводные таблицы",
    cited: [BOOK_CITED, BLOCKED, `${WIKI}/`],
    described: [BOOK, BLOCKED, `${WIKI}/#Uses`],
  },
};
const SCORES: Record<string, { relevance: number; level_fit: number }> = {
  [WIKI]: { relevance: 0.9, level_fit: 0.8 },
  [BOOK]: { relevance: 7, level_fit: 0.8 },
};

const PLAN: ScoutQueries["queries"] = [
  { lang: "en", queries: [SCRIPT.en.query] },
  { lang: "ru", queries: [SCRIPT.ru.query] },
];

// `broken` names a schema whose first reply breaks its contract.
type FakeOptions = { plan?: ScoutQueries["queries"]; broken?: "ScoutQueries" | "Candidates" };

function fakeProvider({ plan = PLAN, broken }: FakeOptions = {}) {
  const prompts: string[] = [];
  // One entry per call: the schema name, or "web_search".
  const log: string[] = [];
  let calls = 0;
  let unbroken = false;
  const breaks = (schema: string) => {
    if (schema !== broken || unbroken) return false;
    unbroken = true;
    return true;
  };
  const reply = <J>(json: J, extra: Partial<ModelResult<J>> = {}) => {
    calls++;
    return {
      text: "",
      json,
      tool_calls: [],
      citations: [],
      image: null,
      usage: { in: 0, out: 0, cost_usd: 0.01 },
      latency_ms: 1,
      model: "fake",
      ...extra,
    } as ModelResult<never>;
  };
  const scripted = (input: string, part: "query" | "cited") =>
    (Object.keys(SCRIPT) as (keyof typeof SCRIPT)[]).find((lang) =>
      [SCRIPT[lang][part]].flat().every((s) => input.includes(s)),
    ) ?? "en";
  const unused = () => {
    throw new Error("the scout does not use this call");
  };
  const provider: Provider = {
    async structured(call) {
      const input = String(call.input);
      prompts.push(`${call.instructions}\n${input}`);
      log.push(call.schema.name);
      if (call.schema.name === "ScoutQueries") {
        return reply({ queries: breaks("ScoutQueries") ? [{ lang: "de", queries: "x" }] : plan });
      }
      const lang = scripted(input, "cited");
      return reply({
        candidates: SCRIPT[lang].described.map((url) => ({
          url,
          title: `Page at ${url}`,
          lang,
          type: "article",
          why_ar: "يشرح الجداول المحورية خطوة بخطوة.",
          ...(SCORES[url] ?? { relevance: 0.5, level_fit: 0.5 }),
          ...(breaks("Candidates") && { relevance: "high" }),
        })),
      });
    },
    async webSearch(call) {
      const input = String(call.input);
      prompts.push(`${call.instructions}\n${input}`);
      log.push("web_search");
      const cited = SCRIPT[scripted(input, "query")].cited;
      return reply(null, {
        text: "Pages found.",
        citations: cited.map((url) => ({ url, title: url, snippet: "" })),
      });
    },
    chat: unused,
    transcribe: unused,
    imageEdit: unused,
    segment: unused,
    totalCostUsd: () => calls * 0.01,
  };
  return { provider, prompts, log, calls: () => calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(options: FakeOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scout-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const fake = fakeProvider(options);
  let providers = 0;
  const orchestrator = createOrchestrator({
    store,
    makeProvider: () => {
      providers++;
      return fake.provider;
    },
  });
  const fetched: string[] = [];
  const pages: PageFetcher = {
    async fetchPage(url) {
      fetched.push(url);
      return WEB[url] ?? { ok: false, url, reason: "HTTP 404" };
    },
  };
  const cache = createFileCache(dir);
  const run = (langs: Lang[], { topic = profile.topic, sessionId = "s1" } = {}) =>
    runScout({
      orchestrator,
      sessionId,
      brief: scoutBrief({ ...profile, topic, source_langs_ok: langs }),
      pages,
      cache,
    });
  return {
    run,
    fake,
    fetched,
    providers: () => providers,
    trace: (sessionId = "s1") => store.readTrace<TraceEvent>(sessionId).map((e) => e.summary_en),
  };
}

describe("scoutBrief", () => {
  it("searches the languages the learner's profile accepts, in the profile's order", () => {
    const brief = scoutBrief({ ...profile, source_langs_ok: ["ru", "en", "ru"] });

    expect(brief.langs).toEqual(["ru", "en"]);
  });

  it("refuses a profile that accepts no source language", () => {
    expect(() => scoutBrief({ ...profile, source_langs_ok: [] })).toThrow(/no source language/);
  });
});

describe("scout", () => {
  it("keeps cited pages whose licence code clears, ranked, with their evidence", async () => {
    const { run, fetched } = setup();

    const result = await run(["en", "ru"]);

    expect(
      result.resources.map((r) => [r.url, r.lang, r.licence.spdx, r.licence.use, r.score]),
    ).toEqual([
      [WIKI, "en", "CC-BY-SA-4.0", "open", 0.89],
      [BOOK_CITED, "ru", "CC-BY-NC-4.0", "personal_study", 0.84],
    ]);
    for (const resource of result.resources) {
      expect(resource.citations).toEqual([{ url: resource.url }]);
      expect(resource.licence).toMatchObject({ evidence_url: resource.url, verified: true });
      expect(resource.licence.quote).not.toBe("");
    }
    expect(fetched.filter((url) => url === WIKI)).toHaveLength(1);
    expect(fetched).not.toContain(INVENTED);
  });

  it("gives a reason for every page it does not keep, and traces each one", async () => {
    const { run, trace } = setup();

    const result = await run(["en", "ru"]);

    expect(result.rejected.map((r) => [r.url, r.reason])).toEqual([
      [INVENTED, "not among the pages the search cited"],
      [OFF_TOPIC, "the model judged it off the topic"],
      [VENDOR, "all rights reserved"],
      [HUGE, expect.stringMatching(/licence terms were not all read/)],
      [BLOCKED, "could not read the page: robots.txt disallows it"],
    ]);
    for (const r of result.rejected) {
      expect(r.reason_ar).toMatch(/\p{Script=Arabic}/u);
      expect(trace()).toContain(`Rejected ${r.url}: ${r.reason}`);
    }
  });

  it("traces the queries for each language and the run's total cost", async () => {
    const { run, trace } = setup();

    await run(["en", "ru"]);

    expect(trace()).toEqual(
      expect.arrayContaining([
        'Queries (en): "pivot table tutorial"',
        'Queries (ru): "сводные таблицы"',
        expect.stringMatching(
          /^Scout chose 2 resources \(en 1, ru 1\) and rejected 5; run cost \$0\.0500/,
        ),
      ]),
    );
  });

  it("searches with at most two of the queries the model wrote for a language", async () => {
    const extra = ["pivot table guide", "pivot table course"];
    const { run, fake, trace } = setup({
      plan: [
        { lang: "en", queries: [SCRIPT.en.query, ...extra] },
        { lang: "ru", queries: [SCRIPT.ru.query] },
      ],
    });

    await run(["en", "ru"]);

    const search = fake.prompts.find((p) => p.includes("Language: English"));
    expect(search).toMatch(/Search queries to try: pivot table tutorial; pivot table guide$/);
    expect(trace()).toContain('Queries (en): "pivot table tutorial", "pivot table guide"');
  });

  it.each([
    { schema: "ScoutQueries", error: "ScoutQueries is invalid: /queries/0/lang" },
    { schema: "Candidates", error: "Candidates is invalid: /candidates/0/relevance" },
  ] as const)(
    "checks $schema against its contract and retries with the errors",
    async ({ schema, error }) => {
      const { run, fake, trace } = setup({ broken: schema });

      const result = await run(["en", "ru"]);

      expect(trace()).toContainEqual(
        expect.stringContaining(`attempt 1 failed; retrying once: ${error}`),
      );
      const asked = fake.prompts.filter((p) => p.includes(`The previous attempt failed: ${error}`));
      expect(asked.length).toBeGreaterThan(0);
      expect(result.resources.map((r) => r.url)).toEqual([WIKI, BOOK_CITED]);
    },
  );

  it("sends the model the topic, goal, level and languages, and nothing else about the learner", async () => {
    const { run, fake } = setup();

    await run(["en", "ru"]);

    const sent = fake.prompts.join("\n");
    expect(sent).toContain(profile.topic);
    expect(sent).toContain(profile.goal);
    for (const secret of [profile.name, profile.id, profile.history_notes, ...profile.background]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("returns the saved result for the same topic and languages without a model call", async () => {
    const { run, fake, providers } = setup();

    const first = await run(["en", "ru"]);
    const calls = fake.calls();
    const again = await run(["ru", "en"]);

    expect(again).toEqual(first);
    expect(fake.calls()).toBe(calls);
    expect(providers()).toBe(1);

    await run(["en", "ru"], { topic: "Another topic" });
    expect(providers()).toBe(2);
  });

  it("reads the result from the cache in a new session, with no model call, and traces it", async () => {
    const { run, fake, trace } = setup();

    const first = await run(["en", "ru"]);
    const calls = fake.calls();
    const again = await run(["ru", "en"], { sessionId: "s2" });

    expect(again).toEqual(first);
    expect(fake.calls()).toBe(calls);
    expect(trace("s2")).toContainEqual(expect.stringMatching(/^Scout result read from the cache/));
  });

  it("pays once for each search when the orchestrator retries the step", async () => {
    const { run, fake, trace } = setup({ broken: "Candidates" });

    await run(["en", "ru"]);

    expect(fake.log.filter((call) => call === "web_search")).toHaveLength(2);
    expect(fake.log.filter((call) => call === "ScoutQueries")).toHaveLength(1);
    expect(trace()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Queries read from the cache/),
        expect.stringMatching(/^web_search \(en\) read from the cache/),
        expect.stringMatching(/^web_search \(ru\) read from the cache/),
      ]),
    );
  });
});

// The topic of the run recorded in demo/fixtures. It is a sample: the demo topic is not decided.
// Re-record with `PROVIDER_PROFILE=record pnpm scout` and this topic set in the shell.
const RECORDED_TOPIC = "Excel pivot tables for data analysis";

describe("scout, replaying the recorded run", () => {
  it("reproduces it offline: cited, licence-checked resources in several languages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-replay-"));
    dirs.push(dir);
    const store = createFileStore(dir);
    const orchestrator = createOrchestrator({
      store,
      makeProvider: (onTrace) =>
        createProvider({ models: loadModels(), profile: "replay", onTrace }),
    });
    const pages = createPageFetcher({
      profile: "replay",
      userAgent: "test",
      transport: async () => {
        throw new Error("replay must not touch the network");
      },
    });
    const brief = scoutBrief({ ...profile, topic: RECORDED_TOPIC });
    const cache = createFileCache(dir);

    const { resources, rejected } = await runScout({
      orchestrator,
      sessionId: "s1",
      brief,
      pages,
      cache,
    });

    expect(resources.length).toBeGreaterThanOrEqual(5);
    expect(new Set(resources.map((r) => r.lang)).size).toBeGreaterThanOrEqual(2);
    for (const r of resources) {
      expect(r.citations).toEqual([{ url: r.url }]);
      expect(r.licence).toMatchObject({
        verified: true,
        evidence_url: expect.stringMatching(/^https:/),
      });
      expect(r.licence.spdx).not.toBe("NOASSERTION");
      expect(r.licence.quote).not.toBe("");
    }
    const trace = store.readTrace<TraceEvent>("s1").map((e) => e.summary_en);
    for (const lang of SOURCE_LANGS) {
      expect(trace.filter((line) => line.startsWith(`Queries (${lang}): `))).toHaveLength(1);
    }
    for (const r of rejected) expect(trace).toContain(`Rejected ${r.url}: ${r.reason}`);
    expect(trace).toContainEqual(expect.stringMatching(/run cost \$\d+\.\d{4} in total$/));
  });
});
