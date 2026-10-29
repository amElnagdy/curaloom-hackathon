// The page fetcher (#17): reads one small page as text, after a robots.txt check, and traces each
// fetch. It follows the provider's profile: `record` saves what it saw under demo/fixtures/pages,
// and `replay` reads it back with no network, so a replayed run checks the same licences.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderProfile } from "../../config.ts";
import type { TraceInput } from "../trace/trace.ts";

export type Page = {
  url: string;
  final_url: string;
  status: number;
  content_type: string;
  // True when the page was longer than the byte cap and only its start was read.
  truncated: boolean;
  text: string;
};

export type FetchOutcome = { ok: true; page: Page } | { ok: false; url: string; reason: string };

export type Trace = (event: Omit<TraceInput, "agent">) => void;

export type PageFetcher = { fetchPage(url: string, trace: Trace): Promise<FetchOutcome> };

export type PageFetcherOptions = {
  profile: ProviderProfile;
  userAgent: string;
  fixturesDir?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

const PAGES_DIR = join(import.meta.dirname, "../../../demo/fixtures/pages");
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 512 * 1024;
const TEXT_TYPES = /^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i;

// What one request saw, as recorded: the response with its body as text, or the network error.
type Seen =
  | { status: number; final_url: string; content_type: string; truncated: boolean; text: string }
  | { error: string };
type Observation = { url: string; latency_ms: number; response: Seen };
type Robots = { disallow: string[] } | { unreadable: string };
// A page is read as HTML or plain text by its type; a robots.txt is read as plain text whatever
// its type, so a mislabelled one keeps its rules.
type Body = "page" | "robots";

export function createPageFetcher(options: PageFetcherOptions): PageFetcher {
  const { profile, userAgent } = options;
  const fixturesDir = options.fixturesDir ?? PAGES_DIR;
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const robots = new Map<string, Promise<Robots>>();

  async function fetchLive(url: string, body: Body): Promise<Seen> {
    try {
      const res = await doFetch(url, {
        headers: { "user-agent": userAgent, accept: "text/html,text/plain;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const content_type = res.headers.get("content-type") ?? "";
      const final_url = res.url || url;
      if (res.status >= 400 || (body === "page" && !TEXT_TYPES.test(content_type))) {
        await res.body?.cancel();
        return { status: res.status, final_url, content_type, truncated: false, text: "" };
      }
      const { bytes, truncated } = await readCapped(res, maxBytes);
      const raw = decode(bytes, content_type);
      const plain = body === "robots" || /^text\/plain/i.test(content_type);
      const text = plain ? raw : htmlToText(raw);
      return { status: res.status, final_url, content_type, truncated, text };
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      return {
        error: timedOut ? `timed out after ${timeoutMs} ms` : `network error: ${String(e)}`,
      };
    }
  }

  async function observe(url: string, body: Body): Promise<Observation> {
    const path = join(fixturesDir, fixtureName(url));
    if (profile === "replay") {
      if (!existsSync(path)) {
        throw new Error(
          `No recorded page for ${url} (${fixtureName(url)}); run once with PROVIDER_PROFILE=record`,
        );
      }
      return JSON.parse(readFileSync(path, "utf8")) as Observation;
    }
    // performance.now() measures a duration, not the time of day, so ADR-004's clock rule does
    // not apply.
    const started = performance.now();
    let response = await fetchLive(url, body);
    if ("error" in response) response = await fetchLive(url, body);
    const observation = { url, latency_ms: Math.round(performance.now() - started), response };
    if (profile === "record") {
      mkdirSync(fixturesDir, { recursive: true });
      writeFileSync(path, `${JSON.stringify(observation, null, 2)}\n`);
    }
    return observation;
  }

  // A site's robots.txt, read once. A 4xx means the site sets no rules; a robots.txt that cannot
  // be read (network error or 5xx) closes the site, as it may be hiding rules.
  function robotsOf(origin: string, trace: Trace): Promise<Robots> {
    let site = robots.get(origin);
    if (!site) {
      site = observe(`${origin}/robots.txt`, "robots").then(({ url, latency_ms, response }) => {
        const found: Robots =
          "error" in response
            ? { unreadable: response.error }
            : response.status >= 500
              ? { unreadable: `HTTP ${response.status}` }
              : { disallow: response.status === 200 ? disallowedForAll(response.text) : [] };
        const seen = "error" in response ? response.error : `HTTP ${response.status}`;
        const rules =
          "disallow" in found ? `${found.disallow.length} Disallow rules for *` : "unreadable";
        trace({
          kind: "tool_call",
          summary_ar: `قرأ قواعد الزحف لموقع ${new URL(origin).host} قبل أن يفتح صفحاته`,
          summary_en: `fetch_page ${url}: ${seen}, ${rules}`,
          latency_ms,
        });
        return found;
      });
      robots.set(origin, site);
    }
    return site;
  }

  return {
    async fetchPage(url, trace) {
      const target = URL.parse(url);
      if (!target || !/^https?:$/.test(target.protocol)) {
        return { ok: false, url, reason: "not an http(s) URL" };
      }
      const site = await robotsOf(target.origin, trace);
      if ("unreadable" in site) {
        return { ok: false, url, reason: `robots.txt could not be read (${site.unreadable})` };
      }
      if (site.disallow.some((rule) => ruleMatches(rule, target.pathname + target.search))) {
        return { ok: false, url, reason: "robots.txt disallows it" };
      }

      const { latency_ms, response } = await observe(url, "page");
      const outcome = outcomeOf(url, response);
      const detail = outcome.ok
        ? `HTTP ${outcome.page.status}, ${Math.round(outcome.page.text.length / 1024)} KB of text${outcome.page.truncated ? ", cut at the byte cap" : ""}`
        : outcome.reason;
      trace({
        kind: "tool_call",
        summary_ar: outcome.ok
          ? `قرأ صفحة مصدر ليتحقق من ترخيصها (${target.host})`
          : `تعذّرت قراءة صفحة مصدر (${target.host})`,
        summary_en: `fetch_page ${url}: ${detail}`,
        latency_ms,
      });
      return outcome;
    },
  };
}

function outcomeOf(url: string, response: Seen): FetchOutcome {
  if ("error" in response) return { ok: false, url, reason: response.error };
  if (response.status >= 400) return { ok: false, url, reason: `HTTP ${response.status}` };
  if (!TEXT_TYPES.test(response.content_type)) {
    return { ok: false, url, reason: `not a text page (${response.content_type || "no type"})` };
  }
  return { ok: true, page: { url, ...response } };
}

function fixtureName(url: string): string {
  const host = URL.parse(url)?.hostname.replace(/[^a-z0-9.-]/gi, "_") || "page";
  return `${host}-${createHash("sha256").update(url).digest("hex").slice(0, 16)}.json`;
}

async function readCapped(res: Response, maxBytes: number) {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= maxBytes) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes: bytes.subarray(0, maxBytes), truncated };
}

// The charset from the Content-Type header, else from a <meta> in the first bytes, else UTF-8.
function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const charset =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]{0,200}charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

// Elements whose content is not page text.
const SKIPPED = new Set(["script", "style", "svg", "noscript", "template"]);
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  laquo: "«",
  raquo: "»",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  lrm: "",
  rlm: "",
};

function decodeEntity(whole: string, code: string): string {
  if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
  const hex = code[1] === "x" || code[1] === "X";
  const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
  const valid = point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
  return valid ? String.fromCodePoint(point) : whole;
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((v) => v !== undefined);

// A tag becomes a space, except that a rel="license" link keeps its URL and an image its alt text.
function keptFrom(tag: string): string {
  const name = /^<([a-z][\w-]*)/i.exec(tag)?.[1]?.toLowerCase();
  if ((name === "a" || name === "link") && /\blicense\b/i.test(attr(tag, "rel") ?? "")) {
    return ` ${attr(tag, "href") ?? ""} `;
  }
  if (name === "img") return ` ${attr(tag, "alt") ?? ""} `;
  return " ";
}

// A single forward scan, so an unclosed comment or <script> costs no more than the rest of the page.
function htmlToText(html: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      parts.push(" ");
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt === -1) break;
    const tag = html.slice(lt, gt + 1);
    const name = /^<([a-z][\w-]*)/i.exec(tag)?.[1]?.toLowerCase();
    if (name && SKIPPED.has(name)) {
      i = endOfElement(html, name, gt + 1);
      parts.push(" ");
      continue;
    }
    parts.push(keptFrom(tag));
    i = gt + 1;
  }
  return parts
    .join("")
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
}

// The index just past `</name ...>`, searching from `from`; the page end when it never closes.
function endOfElement(html: string, name: string, from: number): number {
  for (let at = html.indexOf("</", from); at !== -1; at = html.indexOf("</", at + 2)) {
    if (html.slice(at + 2, at + 2 + name.length).toLowerCase() === name) {
      const gt = html.indexOf(">", at);
      return gt === -1 ? html.length : gt + 1;
    }
  }
  return html.length;
}

// Disallow paths from the groups whose User-agent lines include `*`. Allow lines are not read.
function disallowedForAll(robotsTxt: string): string[] {
  const rules: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const line of robotsTxt.split(/\r?\n/)) {
    const [key = "", ...rest] = line.replace(/#.*/, "").split(":");
    const field = key.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
    } else if (field === "disallow" || field === "allow") {
      inRules = true;
      if (field === "disallow" && value && agents.includes("*")) rules.push(value);
    }
  }
  return rules;
}

// robots.txt path matching: a prefix match where `*` is any run of characters and a final `$`
// anchors the end. Matched with indexOf, not a regex, so a rule full of `*` stays linear.
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const [head = "", ...rest] = (anchored ? rule.slice(0, -1) : rule).split("*");
  if (!path.startsWith(head)) return false;
  if (!rest.length) return !anchored || path.length === head.length;
  let at = head.length;
  for (const part of anchored ? rest.slice(0, -1) : rest) {
    const found = path.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  const tail = rest.at(-1) ?? "";
  return !anchored || (path.endsWith(tail) && path.length - tail.length >= at);
}
