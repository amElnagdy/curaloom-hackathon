// The page fetcher (#17): reads one small page as text, after a robots.txt check, and traces each
// fetch. Web search picks its URLs, so a third party controls them: it requests only public
// addresses on ports 80 and 443, checked before every redirect hop and again at connect time. It
// follows the provider's profile: `record` saves what it saw under demo/fixtures/pages, and
// `replay` reads it back with no network, so a replayed run checks the same licences.

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ProviderProfile } from "../../config.ts";
import type { TraceInput } from "../trace/trace.ts";

export type Page = {
  url: string;
  // The last hop's URL, after any redirects.
  final_url: string;
  status: number;
  content_type: string;
  // True when the page was longer than the byte cap and only its start was read.
  truncated: boolean;
  text: string;
};

export type FetchOutcome = { ok: true; page: Page } | { ok: false; url: string; reason: string };

type Refused = { ok: false; url: string; reason: string };

export type PageView<T> = {
  name: string;
  trace_ar: { ok: string; failed: string };
  read(html: string, url: string): T;
};
export type ViewOutcome<T> = { ok: true; final_url: string; value: T } | Refused;
export type ImageOutcome = { ok: true; final_url: string; mime: string; b64: string } | Refused;

export type Trace = (event: Omit<TraceInput, "agent">) => void;

export type PageFetcher = {
  fetchPage(url: string, trace: Trace): Promise<FetchOutcome>;
  fetchView<T>(url: string, view: PageView<T>, trace: Trace): Promise<ViewOutcome<T>>;
  fetchImage(url: string, trace: Trace): Promise<ImageOutcome>;
};

// Sends one GET and returns the response as is: the fetcher follows redirects itself.
export type Transport = (
  url: URL,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export type PageFetcherOptions = {
  profile: ProviderProfile;
  userAgent: string;
  fixturesDir?: string;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxImageBytes?: number;
};

const PAGES_DIR = join(process.cwd(), "demo/fixtures/pages");
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const PORTS = new Set(["", "80", "443"]);
const TEXT_TYPES = /^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i;
const HTML_TYPES = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const IMAGE_TYPES = /^image\/(?:png|jpeg|gif|webp)\s*(?:;|$)/i;

// What one request saw, as recorded. A transient failure (network error, timeout) is retried once;
// a refused address is not.
type Seen =
  | { kind: "page"; status: number; content_type: string; truncated: boolean; text: string }
  | { kind: "html"; status: number; content_type: string; truncated: boolean; html: string }
  | { kind: "image"; status: number; content_type: string; truncated: boolean; b64: string }
  | { kind: "redirect"; status: number; location: string }
  | { kind: "failed"; reason: string; transient: boolean };
type Final = Exclude<Seen, { kind: "redirect" }>;
type Observation = { url: string; latency_ms: number; response: Seen };
// The hops requested, and what the last one returned or why the next one was refused.
type Followed = { hops: string[]; latency_ms: number } & ({ seen: Final } | { refused: string });
// What a site's robots.txt allows: the Disallow rules for `*`, or why nothing there may be fetched.
type Robots = { disallow: string[] } | { blocked: string };
// A page is read as HTML or plain text by its type; a robots.txt is read as plain text whatever
// its type, so a mislabelled one keeps its rules.
type Body = "page" | "robots" | "html" | "image";

const variantOf = (body: Body) => (body === "page" || body === "robots" ? undefined : body);

const typesOf = (body: Body) =>
  body === "page"
    ? TEXT_TYPES
    : body === "image"
      ? IMAGE_TYPES
      : body === "robots"
        ? /./
        : HTML_TYPES;

// A failure that may pass: a network error or timeout, a busy server or a rate limit.
const passing = (seen: Seen) =>
  seen.kind === "failed"
    ? seen.transient
    : seen.kind === "page" && (seen.status === 429 || seen.status >= 500);

export function createPageFetcher(options: PageFetcherOptions): PageFetcher {
  const { profile, userAgent } = options;
  const fixturesDir = options.fixturesDir ?? PAGES_DIR;
  const transport = options.transport ?? publicTransport();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES;
  const robots = new Map<string, Promise<Robots>>();

  async function fetchLive(url: string, body: Body): Promise<Seen> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await transport(new URL(url), {
        headers: {
          "user-agent": userAgent,
          accept:
            body === "image"
              ? "image/png,image/jpeg,image/gif,image/webp"
              : "text/html,text/plain;q=0.9",
          "accept-encoding": "identity",
        },
        signal,
      });
      const content_type = res.headers.get("content-type") ?? "";
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location !== null) {
        await res.body?.cancel();
        const next = URL.parse(location, url);
        return next
          ? { kind: "redirect", status: res.status, location: next.href }
          : { kind: "failed", reason: `HTTP ${res.status} to an invalid URL`, transient: false };
      }
      if (res.status >= 300 || !typesOf(body).test(content_type)) {
        await res.body?.cancel();
        return { kind: "page", status: res.status, content_type, truncated: false, text: "" };
      }
      const cap = body === "image" ? maxImageBytes : maxBytes;
      const { bytes, truncated } = await readCapped(res, cap);
      const read = { status: res.status, content_type, truncated };
      if (body === "image") {
        return { kind: "image", ...read, b64: Buffer.from(bytes).toString("base64") };
      }
      const raw = decode(bytes, content_type);
      if (body === "html") return { kind: "html", ...read, html: raw };
      const plain = body === "robots" || /^text\/plain/i.test(content_type);
      const text = plain ? raw : htmlToText(raw);
      return { kind: "page", status: res.status, content_type, truncated, text };
    } catch (e) {
      if (e instanceof NotPublic) return { kind: "failed", reason: e.message, transient: false };
      const reason = signal.aborted ? `timed out after ${timeoutMs} ms` : `network error: ${e}`;
      return { kind: "failed", reason, transient: true };
    }
  }

  async function observe(url: string, body: Body): Promise<Observation> {
    const name = fixtureName(url, variantOf(body));
    const path = join(fixturesDir, name);
    if (profile === "replay") {
      if (!existsSync(path)) {
        throw new Error(
          `No recorded page for ${url} (${name}); run once with PROVIDER_PROFILE=record`,
        );
      }
      return JSON.parse(readFileSync(path, "utf8")) as Observation;
    }
    // Recording keeps a page it already has, as the provider keeps a response, so a re-record
    // fetches only new pages. A passing failure is fetched again.
    if (profile === "record" && existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, "utf8")) as Observation;
      if (!passing(saved.response)) return saved;
    }
    // performance.now() measures a duration, not the time of day, so ADR-004's clock rule does
    // not apply.
    const started = performance.now();
    let response = await fetchLive(url, body);
    if (response.kind === "failed" && response.transient) response = await fetchLive(url, body);
    const observation = { url, latency_ms: Math.round(performance.now() - started), response };
    if (profile === "record") {
      mkdirSync(fixturesDir, { recursive: true });
      writeFileSync(path, `${JSON.stringify(observation, null, 2)}\n`);
    }
    return observation;
  }

  // Requests `start` and follows its redirects one hop at a time, so every hop passes the URL
  // checks and `vet` before it is requested.
  async function follow(
    start: string,
    body: Body,
    vet: (url: URL) => Promise<string | null>,
  ): Promise<Followed> {
    const hops: string[] = [];
    let latency_ms = 0;
    for (let next = start; ; ) {
      const url = URL.parse(next);
      const refused = url ? (refusal(url) ?? (await vet(url))) : "not a valid URL";
      if (refused || !url) {
        const reason = hops.length ? `redirect to ${next}: ${refused}` : String(refused);
        return { hops, latency_ms, refused: reason };
      }
      if (hops.length > MAX_REDIRECTS) {
        return { hops, latency_ms, refused: `more than ${MAX_REDIRECTS} redirects` };
      }
      hops.push(url.href);
      const observation = await observe(url.href, body);
      latency_ms += observation.latency_ms;
      const seen = observation.response;
      if (seen.kind !== "redirect") return { hops, latency_ms, seen };
      next = seen.location;
    }
  }

  // A site's robots.txt, read once. A 4xx means the site sets no rules; a robots.txt that cannot
  // be read (network error, refused address, 5xx) closes the site, as it may be hiding rules.
  function robotsOf(origin: string, trace: Trace): Promise<Robots> {
    let site = robots.get(origin);
    if (!site) {
      site = follow(`${origin}/robots.txt`, "robots", async () => null).then((followed) => {
        const found = robotsFrom(followed);
        const rules =
          "disallow" in found ? `${found.disallow.length} Disallow rules for *` : "unreadable";
        if (followed.hops.length) {
          trace({
            kind: "tool_call",
            summary_ar: `قرأ قواعد الزحف لموقع ${new URL(origin).host} قبل أن يفتح صفحاته`,
            summary_en: `fetch_page ${followed.hops.join(" -> ")}: ${seenText(followed)}, ${rules}`,
            latency_ms: followed.latency_ms,
          });
        }
        return found;
      });
      robots.set(origin, site);
    }
    return site;
  }

  function followAllowed(url: string, body: Body, trace: Trace): Promise<Followed> {
    return follow(url, body, async (hop) => {
      const site = await robotsOf(hop.origin, trace);
      if ("blocked" in site) return site.blocked;
      const path = hop.pathname + hop.search;
      return site.disallow.some((rule) => ruleMatches(rule, path))
        ? "robots.txt disallows it"
        : null;
    });
  }

  return {
    async fetchPage(url, trace) {
      const followed = await followAllowed(url, "page", trace);
      const outcome: FetchOutcome =
        "refused" in followed
          ? { ok: false, url, reason: followed.refused }
          : outcomeOf(url, followed.hops.at(-1) ?? url, followed.seen);
      const detail = outcome.ok
        ? `HTTP ${outcome.page.status}, ${Math.round(outcome.page.text.length / 1024)} KB of text${outcome.page.truncated ? ", cut at the byte cap" : ""}`
        : outcome.reason;
      traceFetch(trace, "fetch_page", followed, outcome.ok, detail, {
        ok: "قرأ صفحة مصدر ليتحقق من ترخيصها",
        failed: "تعذّرت قراءة صفحة مصدر",
      });
      return outcome;
    },

    async fetchView<T>(url: string, view: PageView<T>, trace: Trace): Promise<ViewOutcome<T>> {
      const followed = await followAllowed(url, "html", trace);
      const reason = "refused" in followed ? followed.refused : whyUnread(followed.seen, "html");
      const seen = "seen" in followed ? followed.seen : null;
      const final_url = followed.hops.at(-1) ?? url;
      const outcome: ViewOutcome<T> =
        seen?.kind === "html" && reason === null
          ? { ok: true, final_url, value: view.read(seen.html, final_url) }
          : { ok: false, url, reason: reason ?? "not read" };
      const detail = outcome.ok ? "read" : outcome.reason;
      traceFetch(trace, `fetch_page[${view.name}]`, followed, outcome.ok, detail, view.trace_ar);
      return outcome;
    },

    async fetchImage(url, trace) {
      const followed = await followAllowed(url, "image", trace);
      const reason = "refused" in followed ? followed.refused : whyUnread(followed.seen, "image");
      const seen = "seen" in followed ? followed.seen : null;
      const outcome: ImageOutcome =
        seen?.kind === "image" && reason === null
          ? {
              ok: true,
              final_url: followed.hops.at(-1) ?? url,
              mime: seen.content_type.split(";")[0]?.trim().toLowerCase() ?? "",
              b64: seen.b64,
            }
          : { ok: false, url, reason: reason ?? "not read" };
      const detail = outcome.ok
        ? `${outcome.mime}, ${Math.round((outcome.b64.length * 3) / 4 / 1024)} KB`
        : outcome.reason;
      traceFetch(trace, "fetch_image", followed, outcome.ok, detail, {
        ok: "نزّل صورة رسم من مصدر الدرس",
        failed: "تعذّر تنزيل صورة رسم من مصدر الدرس",
      });
      return outcome;
    },
  };
}

function traceFetch(
  trace: Trace,
  tool: string,
  followed: Followed,
  ok: boolean,
  detail: string,
  text: { ok: string; failed: string },
) {
  const [first] = followed.hops;
  if (!first) return;
  trace({
    kind: "tool_call",
    summary_ar: `${ok ? text.ok : text.failed} (${new URL(first).host})`,
    summary_en: `${tool} ${followed.hops.join(" -> ")}: ${detail}`,
    latency_ms: followed.latency_ms,
  });
}

function whyUnread(seen: Final, kind: "html" | "image"): string | null {
  if (seen.kind === "failed") return seen.reason;
  if (seen.status >= 300) return `HTTP ${seen.status}`;
  if (seen.kind !== kind) {
    const wanted = kind === "image" ? "a PNG, JPEG, GIF or WebP image" : "an HTML page";
    return `not ${wanted} (${seen.content_type || "no type"})`;
  }
  return seen.truncated ? "cut at the byte cap" : null;
}

// Why a URL may not be requested at all, or null when it may. A host name is checked again at
// connect time, by publicTransport.
function refusal(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "not an http(s) URL";
  if (!PORTS.has(url.port)) return `port ${url.port} is not 80 or 443`;
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return isIP(host) && !isPublicAddress(host) ? `${host} is not a public address` : null;
}

function robotsFrom(followed: Followed): Robots {
  if ("refused" in followed) {
    return { blocked: `robots.txt could not be read (${followed.refused})` };
  }
  const { seen } = followed;
  if (seen.kind === "failed") return { blocked: `robots.txt could not be read (${seen.reason})` };
  if (seen.kind === "page" && seen.status === 200) return { disallow: disallowedForAll(seen.text) };
  if (seen.status >= 400 && seen.status < 500) return { disallow: [] };
  return { blocked: `robots.txt could not be read (HTTP ${seen.status})` };
}

function seenText(followed: Followed): string {
  if ("refused" in followed) return followed.refused;
  return followed.seen.kind === "failed" ? followed.seen.reason : `HTTP ${followed.seen.status}`;
}

function outcomeOf(url: string, final_url: string, seen: Final): FetchOutcome {
  if (seen.kind === "failed") return { ok: false, url, reason: seen.reason };
  if (seen.status >= 300) return { ok: false, url, reason: `HTTP ${seen.status}` };
  if (seen.kind !== "page" || !TEXT_TYPES.test(seen.content_type)) {
    return { ok: false, url, reason: `not a text page (${seen.content_type || "no type"})` };
  }
  const { kind: _, ...page } = seen;
  return { ok: true, page: { url, final_url, ...page } };
}

// Address ranges off the public internet (the IANA special-purpose registries). For IPv6 only
// global unicast, 2000::/3, is public, which also refuses every IPv4-mapped and NAT64 form. One
// list per family: a BlockList also matches an IPv4 address against IPv6 rules in its mapped form.
const NOT_PUBLIC = { ipv4: new BlockList(), ipv6: new BlockList() };
for (const [network, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"], // "this network"
  ["10.0.0.0", 8, "ipv4"], // private
  ["100.64.0.0", 10, "ipv4"], // carrier-grade NAT
  ["127.0.0.0", 8, "ipv4"], // loopback
  ["169.254.0.0", 16, "ipv4"], // link-local, cloud metadata
  ["172.16.0.0", 12, "ipv4"], // private
  ["192.0.0.0", 24, "ipv4"], // IETF protocol assignments
  ["192.0.2.0", 24, "ipv4"], // documentation
  ["192.88.99.0", 24, "ipv4"], // 6to4 relay anycast
  ["192.168.0.0", 16, "ipv4"], // private
  ["198.18.0.0", 15, "ipv4"], // benchmarking
  ["198.51.100.0", 24, "ipv4"], // documentation
  ["203.0.113.0", 24, "ipv4"], // documentation
  ["224.0.0.0", 4, "ipv4"], // multicast
  ["240.0.0.0", 4, "ipv4"], // reserved, broadcast
  ["::", 3, "ipv6"], // loopback, unspecified, IPv4-mapped, NAT64, discard
  ["4000::", 2, "ipv6"], // not global unicast
  ["8000::", 1, "ipv6"], // unique-local, link-local, multicast
  ["2001::", 23, "ipv6"], // IETF protocol assignments, Teredo
  ["2001:db8::", 32, "ipv6"], // documentation
  ["2002::", 16, "ipv6"], // 6to4
  ["3fff::", 20, "ipv6"], // documentation
] as const) {
  NOT_PUBLIC[family].addSubnet(network, prefix, family);
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (!version) return false;
  const family = version === 4 ? "ipv4" : "ipv6";
  return !NOT_PUBLIC[family].check(ip, family);
}

class NotPublic extends Error {}

export type Resolve = (hostname: string) => Promise<string[]>;

const systemResolve: Resolve = async (hostname) =>
  (await lookup(hostname, { all: true })).map((a) => a.address);

// A connect-time lookup that refuses a host when any address it resolves to is not public. The
// socket connects to an address this returned, so DNS cannot change between check and connect.
function publicLookup(resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const bad = addresses.find((address) => !isPublicAddress(address));
        if (bad || !addresses.length) {
          const found = bad ?? "no address";
          callback(new NotPublic(`${hostname} resolves to ${found}, not a public address`), "");
          return;
        }
        const all = addresses
          .map((address) => ({ address, family: isIP(address) }))
          .filter((a) => !options.family || a.family === options.family);
        const [first] = all;
        if (!first) callback(new NotPublic(`${hostname} has no IPv${options.family} address`), "");
        else if (options.all) callback(null, all);
        else callback(null, first.address, first.family);
      },
      (e: NodeJS.ErrnoException) => callback(e, ""),
    );
  };
}

// The default transport: node:http(s) with publicLookup, as fetch() has no hook at connect time.
export function publicTransport(resolve: Resolve = systemResolve): Transport {
  const lookup = publicLookup(resolve);
  return (url, { headers, signal }) =>
    new Promise((resolveResponse, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(url, { headers, signal, lookup }, (res) => {
        try {
          resolveResponse(toResponse(res));
        } catch (e) {
          res.destroy();
          reject(e);
        }
      });
      req.on("error", reject);
      req.end();
    });
}

function toResponse(res: IncomingMessage): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    for (const v of [value ?? []].flat()) headers.append(name, v);
  }
  const status = res.statusCode ?? 0;
  const noBody = status === 204 || status === 205 || status === 304;
  if (noBody) res.resume();
  const body = noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
  return new Response(body, { status, headers });
}

function fixtureName(url: string, variant?: string): string {
  const host = URL.parse(url)?.hostname.replace(/[^a-z0-9.-]/gi, "_") || "page";
  const key = variant ? `${variant} ${url}` : url;
  return `${host}-${createHash("sha256").update(key).digest("hex").slice(0, 16)}.json`;
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
