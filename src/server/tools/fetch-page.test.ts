import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceInput } from "../trace/trace.ts";
import {
  createPageFetcher,
  isPublicAddress,
  type PageFetcherOptions,
  publicTransport,
  type Transport,
} from "./fetch-page.ts";

type Served = { status?: number; type?: string; location?: string; body: string };

// A fake web: each URL serves a fixed response, and every request is logged.
function fakeWeb(pages: Record<string, Served>) {
  const requested: string[] = [];
  const transport: Transport = async (url) => {
    requested.push(url.href);
    const page = pages[url.href];
    if (!page)
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    const headers = new Headers({ "content-type": page.type ?? "text/html; charset=utf-8" });
    if (page.location) headers.set("location", page.location);
    return new Response(page.body, { status: page.status ?? 200, headers });
  };
  return { transport, requested };
}

const noNetwork: Transport = async () => {
  throw new Error("replay must not touch the network");
};

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
    const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

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
    const recorder = fetcher({ profile: "record", transport: web.transport });
    const recorded = await recorder.pages.fetchPage(PAGE, recorder.trace);

    const replayer = fetcher({
      profile: "replay",
      transport: noNetwork,
      fixturesDir: recorder.fixturesDir,
    });
    const replayed = await replayer.pages.fetchPage(PAGE, replayer.trace);

    expect(replayed).toEqual(recorded);
    expect(replayer.events.map((e) => e.summary_en)).toEqual(
      recorder.events.map((e) => e.summary_en),
    );
  });

  it("fails loudly in replay when a page was never recorded", async () => {
    const { pages, trace } = fetcher({ profile: "replay", transport: noNetwork });

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
    const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

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
      const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

      expect(await pages.fetchPage(blocked, trace)).toMatchObject({
        ok: false,
        reason: "robots.txt disallows it",
      });
    },
  );

  it("fetches nothing from a site whose robots.txt cannot be read", async () => {
    const down = fakeWeb({ [PAGE]: { body: HTML } });
    const failing: Transport = async (url, init) => {
      if (url.href === ROBOTS) throw new TypeError("fetch failed");
      return down.transport(url, init);
    };
    const broken = fakeWeb({ [ROBOTS]: { status: 503, type: "text/plain", body: "" } });

    for (const web of [{ ...down, transport: failing }, broken]) {
      const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

      const outcome = await pages.fetchPage(PAGE, trace);

      expect(outcome).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/robots\.txt could not be read/),
      });
      expect(web.requested).not.toContain(PAGE);
    }
  });

  it("retries a page once after a network failure", async () => {
    const web = fakeWeb({ [PAGE]: { body: HTML } });
    let failures = 1;
    const flaky: Transport = async (url, init) => {
      if (url.href === PAGE && failures-- > 0) throw new TypeError("fetch failed");
      return web.transport(url, init);
    };
    const { pages, trace } = fetcher({ profile: "live", transport: flaky });

    expect((await pages.fetchPage(PAGE, trace)).ok).toBe(true);
  });

  it.each([
    { url: "http://127.0.0.1/", reason: /127\.0\.0\.1 is not a public address/ },
    {
      url: "http://169.254.169.254/latest/meta-data",
      reason: /169\.254\.169\.254 is not a public address/,
    },
    { url: "http://[::ffff:10.0.0.1]/", reason: /::ffff:a00:1 is not a public address/ },
    { url: "https://open.example.org:8443/course", reason: /port 8443 is not 80 or 443/ },
    { url: "file:///etc/passwd", reason: /not an http\(s\) URL/ },
  ])("refuses $url without a request", async ({ url, reason }) => {
    const web = fakeWeb({});
    const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

    expect(await pages.fetchPage(url, trace)).toMatchObject({ ok: false, url, reason });
    expect(web.requested).toEqual([]);
  });

  it("refuses a redirect to a private address before requesting it", async () => {
    const web = fakeWeb({ [PAGE]: { status: 302, location: "http://10.0.0.1/admin", body: "" } });
    const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

    expect(await pages.fetchPage(PAGE, trace)).toMatchObject({
      ok: false,
      reason: "redirect to http://10.0.0.1/admin: 10.0.0.1 is not a public address",
    });
    expect(web.requested).toEqual([ROBOTS, PAGE]);
  });

  it("follows a redirect after reading the new site's robots.txt", async () => {
    const mirror = "https://mirror.example.org/pivot";
    const mirrorRobots = "https://mirror.example.org/robots.txt";
    const web = fakeWeb({
      [PAGE]: { status: 301, location: mirror, body: "" },
      [mirrorRobots]: { type: "text/plain", body: "User-agent: *\nDisallow: /private/" },
      [mirror]: { body: HTML },
    });
    const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

    expect(await pages.fetchPage(PAGE, trace)).toMatchObject({
      ok: true,
      page: { url: PAGE, final_url: mirror },
    });
    expect(web.requested).toEqual([ROBOTS, PAGE, mirrorRobots, mirror]);
  });

  it("stops after three redirects", async () => {
    const at = (path: string) => `https://open.example.org${path}`;
    const web = fakeWeb({
      [PAGE]: { status: 302, location: "/r1", body: "" },
      [at("/r1")]: { status: 302, location: "/r2", body: "" },
      [at("/r2")]: { status: 302, location: "/r3", body: "" },
      [at("/r3")]: { status: 302, location: "/r4", body: "" },
    });
    const { pages, trace } = fetcher({ profile: "live", transport: web.transport });

    expect(await pages.fetchPage(PAGE, trace)).toMatchObject({
      ok: false,
      reason: "more than 3 redirects",
    });
    expect(web.requested).toEqual([ROBOTS, PAGE, at("/r1"), at("/r2"), at("/r3")]);
  });

  it("refuses at connect time a host that resolves to a private address", async () => {
    const resolved: string[] = [];
    const transport = publicTransport(async (host) => {
      resolved.push(host);
      return ["93.184.215.14", "10.0.0.7"];
    });
    const { pages, trace } = fetcher({ profile: "live", transport });

    expect(await pages.fetchPage("https://rebind.example/page", trace)).toMatchObject({
      ok: false,
      reason: /rebind\.example resolves to 10\.0\.0\.7, not a public address/,
    });
    expect(resolved).toEqual(["rebind.example"]);
  });

  it("reads at most maxBytes of a large page", async () => {
    const big = `<p>${"pivot ".repeat(50_000)}</p>`;
    const web = fakeWeb({ [PAGE]: { body: big } });
    const { pages, trace } = fetcher({
      profile: "live",
      transport: web.transport,
      maxBytes: 10_000,
    });

    const outcome = await pages.fetchPage(PAGE, trace);

    expect(outcome.ok && outcome.page.truncated).toBe(true);
    expect(outcome.ok ? outcome.page.text.length : 0).toBeLessThanOrEqual(10_000);
  });

  it("reports an HTTP error, a non-text page and a timeout as failures", async () => {
    const pdf = "https://open.example.org/book.pdf";
    const slow = "https://slow.example.org/page";
    const web = fakeWeb({ [pdf]: { type: "application/pdf", body: "%PDF-1.7" } });
    const hang: Transport = async (url, init) => {
      if (!url.href.startsWith("https://slow.")) return web.transport(url, init);
      return new Promise<Response>((_, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      );
    };
    const { pages, trace } = fetcher({ profile: "live", transport: hang, timeoutMs: 50 });

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
    const { pages, events, trace } = fetcher({ profile: "live", transport: web.transport });

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

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["208.80.154.224", true],
    ["172.32.0.1", true],
    ["100.128.0.1", true],
    ["2620:0:862:ed1a::1", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["192.0.2.10", false],
    ["198.18.0.1", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fe80::1%lo0", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],
    ["ff02::1", false],
    ["2001:db8::1", false],
    ["2002:a00:1::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:169.254.169.254", false],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::a00:1", false],
    ["example.org", false],
    ["999.1.1.1", false],
    ["", false],
  ])("%s is public: %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});
