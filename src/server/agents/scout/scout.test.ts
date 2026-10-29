import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Resource } from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { createOrchestrator } from "../../orchestrator/orchestrator.ts";
import type { ModelResult, Provider } from "../../providers/provider.ts";
import { createFileStore } from "../../store/store.ts";
import type { FetchOutcome, PageFetcher } from "../../tools/fetch-page.ts";
import type { TraceEvent } from "../../trace/trace.ts";
import { runScout, scoutBrief } from "./scout.ts";

type Lang = Resource["lang"];

const profile = loadOmarSeed("Pivot tables in spreadsheets").profile;

const WIKI = "https://en.wikipedia.org/wiki/Pivot_table";
const VENDOR = "https://vendor.example/pivot";
const HUGE = "https://big.example/pivot";
const INVENTED = "https://invented.example/pivot";
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
// then describes (one invented, one a second spelling of a page another language found).
const SCRIPT: Record<"en" | "ru", { query: string; cited: string[]; described: string[] }> = {
  en: {
    query: "pivot table tutorial",
    cited: [WIKI, VENDOR, HUGE],
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

function fakeProvider() {
  const prompts: string[] = [];
  let calls = 0;
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
      if (call.schema.name === "ScoutQueries") {
        return reply({
          queries: [
            { lang: "en", queries: [SCRIPT.en.query] },
            { lang: "ru", queries: [SCRIPT.ru.query] },
          ],
        });
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
        })),
      });
    },
    async webSearch(call) {
      const input = String(call.input);
      prompts.push(`${call.instructions}\n${input}`);
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
  return { provider, prompts, calls: () => calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "scout-"));
  dirs.push(dir);
  const store = createFileStore(dir);
  const fake = fakeProvider();
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
  const run = (langs: Lang[], topic = profile.topic) =>
    runScout({
      orchestrator,
      sessionId: "s1",
      brief: scoutBrief({ ...profile, topic }, langs),
      pages,
    });
  return {
    run,
    fake,
    fetched,
    providers: () => providers,
    trace: () => store.readTrace<TraceEvent>("s1").map((e) => e.summary_en),
  };
}

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

  it("rejects uncited, unlicensed, unreadable and cut pages, and traces each reason", async () => {
    const { run, trace } = setup();

    const result = await run(["en", "ru"]);

    expect(result.rejected.map((r) => [r.url, r.reason])).toEqual([
      [INVENTED, "not among the pages the search cited"],
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
          /^Scout chose 2 resources \(en 1, ru 1\) and rejected 4; run cost \$0\.0500/,
        ),
      ]),
    );
  });

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

    await run(["en", "ru"], "Another topic");
    expect(providers()).toBe(2);
  });
});
