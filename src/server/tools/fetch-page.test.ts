import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceInput } from "../trace/trace.ts";
import { createPageFetcher, type PageFetcherOptions } from "./fetch-page.ts";

type Served = { status?: number; type?: string; body: string };

// A fake web: each URL serves a fixed response, and every request is logged.
function fakeWeb(pages: Record<string, Served>) {
  const requested: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const page = pages[url];
    if (!page)
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(page.body, {
      status: page.status ?? 200,
      headers: { "content-type": page.type ?? "text/html; charset=utf-8" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requested };
}

const noNetwork = (async () => {
  throw new Error("replay must not touch the network");
}) as typeof fetch;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fetcher(options: Partial<PageFetcherOptions> & Pick<PageFetcherOptions, "profile">) {
  const fixturesDir = options.fixturesDir ?? mkdtempSync(join(tmpdir(), "pages-"));
  dirs.push(fixturesDir);
  const events: Omit<TraceInput, "agent">[] = [];
  const pages = createPageFetcher({ userAgent: "test-scout", fixturesDir, ...options });
  return { pages, events, fixturesDir, trace: (e: Omit<TraceInput, "agent">) => events.push(e) };
}

const ROBOTS = "https://open.example.org/robots.txt";
const PAGE = "https://open.example.org/course/pivot";
const HTML = `<!doctype html><html><head><title>Pivot tables</title>
<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">
<style>.x{color:red}</style><script>var licence = "All rights reserved";</script></head>
<body><h1>Pivot&nbsp;tables</h1><p>Summarise rows &amp; columns.</p>
<footer>&copy; 2026 Open Example. Licensed under <a href="/terms">CC&nbsp;BY 4.0</a>.</footer></body></html>`;

describe("fetchPage", () => {
  it("returns the page as text, keeping a rel=license link and dropping scripts and styles", async () => {
    const web = fakeWeb({ [PAGE]: { body: HTML } });
    const { pages, trace } = fetcher({ profile: "live", fetch: web.fetch });

    const outcome = await pages.fetchPage(PAGE, trace);

    expect(outcome.ok).toBe(true);
    const text = outcome.ok ? outcome.page.text : "";
    expect(text).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(text).toContain("Summarise rows & columns.");
    expect(text).toContain("© 2026 Open Example. Licensed under CC BY 4.0 .");
    expect(text).not.toMatch(/All rights reserved|color:red/);
  });

  it("replays a recorded page and robots.txt without touching the network", async () => {
    const web = fakeWeb({
      [ROBOTS]: { type: "text/plain", body: "User-agent: *\nDisallow: /private/" },
      [PAGE]: { body: HTML },
    });
    const recorder = fetcher({ profile: "record", fetch: web.fetch });
    const recorded = await recorder.pages.fetchPage(PAGE, recorder.trace);

    const replayer = fetcher({
      profile: "replay",
      fetch: noNetwork,
      fixturesDir: recorder.fixturesDir,
    });
    const replayed = await replayer.pages.fetchPage(PAGE, replayer.trace);

    expect(replayed).toEqual(recorded);
    expect(replayer.events.map((e) => e.summary_en)).toEqual(
      recorder.events.map((e) => e.summary_en),
    );
  });

  it("fails loudly in replay when a page was never recorded", async () => {
    const { pages, trace } = fetcher({ profile: "replay", fetch: noNetwork });

    await expect(pages.fetchPage(PAGE, trace)).rejects.toThrow(/PROVIDER_PROFILE=record/);
  });

  it("does not fetch a page that robots.txt disallows for every crawler", async () => {
    const blocked = "https://open.example.org/private/notes";
    const web = fakeWeb({
      [ROBOTS]: {
        type: "text/plain",
        body: "User-agent: *\nDisallow: /private/ # members only\n\nUser-agent: Googlebot\nDisallow: /\n",
      },
      [blocked]: { body: HTML },
      [PAGE]: { body: HTML },
    });
    const { pages, trace } = fetcher({ profile: "live", fetch: web.fetch });

    const outcome = await pages.fetchPage(blocked, trace);
    const allowed = await pages.fetchPage(PAGE, trace);

    expect(outcome).toEqual({ ok: false, url: blocked, reason: "robots.txt disallows it" });
    expect(web.requested).not.toContain(blocked);
    expect(allowed.ok).toBe(true);
    expect(web.requested.filter((url) => url === ROBOTS)).toHaveLength(1);
  });

  it.each(["text/html", "application/octet-stream"])(
    "reads the rules of a robots.txt served as %s",
    async (type) => {
      const blocked = "https://open.example.org/private/notes";
      const web = fakeWeb({ [ROBOTS]: { type, body: "User-agent: *\nDisallow: /private/\n" } });
      const { pages, trace } = fetcher({ profile: "live", fetch: web.fetch });

      expect(await pages.fetchPage(blocked, trace)).toMatchObject({
        ok: false,
        reason: "robots.txt disallows it",
      });
    },
  );

  it("fetches nothing from a site whose robots.txt cannot be read", async () => {
    const down = fakeWeb({ [PAGE]: { body: HTML } });
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === ROBOTS) throw new TypeError("fetch failed");
      return down.fetch(input, init);
    }) as typeof fetch;
    const broken = fakeWeb({ [ROBOTS]: { status: 503, type: "text/plain", body: "" } });

    for (const web of [{ ...down, fetch: failing }, broken]) {
      const { pages, trace } = fetcher({ profile: "live", fetch: web.fetch });

      const outcome = await pages.fetchPage(PAGE, trace);

      expect(outcome).toMatchObject({ ok: false, reason: /robots\.txt could not be read/ });
      expect(web.requested).not.toContain(PAGE);
    }
  });

  it("retries a page once after a network failure", async () => {
    const web = fakeWeb({ [PAGE]: { body: HTML } });
    let failures = 1;
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === PAGE && failures-- > 0) throw new TypeError("fetch failed");
      return web.fetch(input, init);
    }) as typeof fetch;
    const { pages, trace } = fetcher({ profile: "live", fetch: flaky });

    expect((await pages.fetchPage(PAGE, trace)).ok).toBe(true);
  });

  it("reads at most maxBytes of a large page", async () => {
    const big = `<p>${"pivot ".repeat(50_000)}</p>`;
    const web = fakeWeb({ [PAGE]: { body: big } });
    const { pages, trace } = fetcher({ profile: "live", fetch: web.fetch, maxBytes: 10_000 });

    const outcome = await pages.fetchPage(PAGE, trace);

    expect(outcome.ok && outcome.page.truncated).toBe(true);
    expect(outcome.ok ? outcome.page.text.length : 0).toBeLessThanOrEqual(10_000);
  });

  it("reports an HTTP error, a non-text page and a timeout as failures", async () => {
    const pdf = "https://open.example.org/book.pdf";
    const slow = "https://slow.example.org/page";
    const web = fakeWeb({ [pdf]: { type: "application/pdf", body: "%PDF-1.7" } });
    const hang = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://slow.")) return web.fetch(input, init);
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );
    }) as typeof fetch;
    const { pages, trace } = fetcher({ profile: "live", fetch: hang, timeoutMs: 50 });

    expect(await pages.fetchPage(PAGE, trace)).toMatchObject({ ok: false, reason: "HTTP 404" });
    expect(await pages.fetchPage(pdf, trace)).toMatchObject({
      ok: false,
      reason: /not a text page/,
    });
    expect(await pages.fetchPage(slow, trace)).toMatchObject({
      ok: false,
      reason: /timed out|network/,
    });
  });

  it("traces each fetch as a tool call with Arabic and English summaries", async () => {
    const web = fakeWeb({ [ROBOTS]: { type: "text/plain", body: "" }, [PAGE]: { body: HTML } });
    const { pages, events, trace } = fetcher({ profile: "live", fetch: web.fetch });

    await pages.fetchPage(PAGE, trace);

    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.kind).toBe("tool_call");
      expect(event.summary_ar).toMatch(/\p{Script=Arabic}/u);
      expect(event.summary_en).toContain("open.example.org");
      expect(event.latency_ms).toBeGreaterThanOrEqual(0);
    }
  });
});
