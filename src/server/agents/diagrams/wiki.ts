// A Wikimedia page's licence does not cover its images: each image's own file page states its
// licence and author.
//
// The MediaWiki API would say the same, but robots.txt on every Wikimedia wiki disallows /w/ for
// all agents, and the page fetcher obeys robots.txt. Article pages, file pages and
// upload.wikimedia.org are allowed.

import type { Diagram } from "../../../../contracts/index.ts";
import type { PageView } from "../../tools/fetch-page.ts";
import { classifyLicence } from "../scout/licence.ts";

const WIKIMEDIA = /(^|\.)(wikipedia|wikibooks|wikiversity|wikisource|wikivoyage|wikimedia)\.org$/;

export const isWikimediaPage = (url: string) => WIKIMEDIA.test(URL.parse(url)?.hostname ?? "");

export type Figure = { file_page: string; heading: string; width: number; height: number };

export type FileInfo = {
  licences: string[];
  author: string | null;
  image_url: string | null;
  mime: string | null;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decoded = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const point =
      code[1] === "x" || code[1] === "X"
        ? Number.parseInt(code.slice(2), 16)
        : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });

const plainText = (html: string) =>
  decoded(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/ (?=[.,;:])/g, "")
    .trim();

const attrOf = (tag: string, name: string) => {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return found ? decoded(found[1] ?? found[2] ?? "") : undefined;
};

const unescaped = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
const fileName = (path: string) => unescaped(path).replace(/ /g, "_");

export const fileTitle = (filePage: string) =>
  unescaped(filePage.split("/").pop() ?? "")
    .replace(/^[^:]*:/, "")
    .replace(/_/g, " ");

const MIN_FILE = { width: 200, height: 100 };
const MIN_SHOWN_WIDTH = 120;

const HEADING_OR_LINKED_IMAGE =
  /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>|<a\b([^>]*)>\s*<img\b([^>]*)>/gi;
const COMMONS_UPLOAD = /\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//;

const showsOwnFile = (src: string, title: string) => fileName(src).includes(fileName(title));

export function figuresOf(html: string, pageUrl: string): Figure[] {
  const figures: Figure[] = [];
  let heading = "";
  for (const [, , headingHtml, link, img] of html.matchAll(HEADING_OR_LINKED_IMAGE)) {
    if (headingHtml !== undefined) {
      heading = plainText(headingHtml);
      continue;
    }
    const href = attrOf(link ?? "", "href");
    const src = attrOf(img ?? "", "src");
    if (!href || !src || !/\bmw-file-description\b/.test(attrOf(link ?? "", "class") ?? "")) {
      continue;
    }
    const filePage = URL.parse(href, pageUrl);
    const segment = unescaped(filePage?.pathname.split("/").pop() ?? "");
    const title = segment.includes(":") ? segment.slice(segment.indexOf(":") + 1) : "";
    if (!filePage || !title || !showsOwnFile(src, title)) continue;
    const width = Number(attrOf(img ?? "", "data-file-width"));
    const height = Number(attrOf(img ?? "", "data-file-height"));
    const shown = Number(attrOf(img ?? "", "width"));
    if (width < MIN_FILE.width || height < MIN_FILE.height || shown < MIN_SHOWN_WIDTH) continue;
    const file_page = COMMONS_UPLOAD.test(src)
      ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName(title))}`
      : `${filePage.origin}${filePage.pathname}`;
    if (figures.some((f) => f.file_page === file_page)) continue;
    figures.push({ file_page, heading, width, height });
  }
  return figures;
}

// A Commons template may write a class as licensetpl&#95;short.
const classesOf = (tag: string) => (attrOf(tag, "class") ?? "").split(/\s+/);

function spansOf(html: string, name: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<(span|div|td)\b([^>]*)>([^<]*)<\/\1>/gi)) {
    if (classesOf(m[2] ?? "").includes(name)) found.push(plainText(m[3] ?? ""));
  }
  return found;
}

const SVG_WIDTH = 1280;
const svgRendering = (url: string) => {
  const m =
    /^(https:\/\/upload\.wikimedia\.org\/[^/]+\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+\.svg)$/i.exec(
      url,
    );
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${SVG_WIDTH}px-${m[3]}.png` : null;
};

export function fileInfoOf(html: string, fileUrl: string): FileInfo {
  const licences = [...new Set(spansOf(html, "licensetpl_short").filter(Boolean))];
  // Commons writes the row's id as fileinfotpl&#95;aut, so the id is matched decoded.
  const authorCell = [
    ...html.matchAll(/<td\b([^>]*)>[^<]*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi),
  ].find((m) => attrOf(m[1] ?? "", "id") === "fileinfotpl_aut")?.[2];
  const author = plainText(authorCell ?? "").slice(0, 300);
  const media = /<div\b[^>]*class="fullMedia"[^>]*>[\s\S]*?<a\b([^>]*)>/i.exec(html);
  const href = media ? attrOf(media[1] ?? "", "href") : undefined;
  const original = href ? URL.parse(href, fileUrl) : null;
  const url = original ? `${original.origin}${original.pathname}` : null;
  const mime = /<span class="mime-type">([^<]+)<\/span>/i.exec(html)?.[1]?.trim() ?? null;
  const svg = mime === "image/svg+xml" && url ? svgRendering(url) : null;
  return {
    licences,
    author: author || null,
    image_url: svg ?? (mime === "image/svg+xml" ? null : url),
    mime: svg ? "image/png" : mime,
  };
}

export const FIGURES: PageView<Figure[]> = {
  name: "figures",
  trace_ar: {
    ok: "قرأ صفحة مصدر ليجد الرسوم فيها",
    failed: "تعذّرت قراءة صفحة مصدر ليجد الرسوم فيها",
  },
  read: figuresOf,
};

export const FILE_PAGE: PageView<FileInfo> = {
  name: "file",
  trace_ar: {
    ok: "قرأ صفحة ملف رسم ليتحقق من ترخيصه ومؤلفه",
    failed: "تعذّرت قراءة صفحة ملف رسم",
  },
  read: fileInfoOf,
};

export type ImageLicence =
  | ({ ok: true } & Diagram["licence"])
  | { ok: false; reason: string; reason_ar: string };

const PUBLIC_DOMAIN = /^(public domain|PD\b)/i;
const ADAPTABLE = /^(LicenseRef-PublicDomain|CC0-1\.0|CC-BY(-SA)?(-\d\.\d)?)$/;

export const forbidsChanges = (spdx: string) => /-ND(-|$)/.test(spdx);

const deedOf = (spdx: string) => {
  const cc = /^CC-(BY(?:-NC)?(?:-ND|-SA)?)(?:-(\d\.\d))?$/.exec(spdx);
  if (cc?.[2]) return `https://creativecommons.org/licenses/${cc[1]?.toLowerCase()}/${cc[2]}/`;
  return spdx === "CC0-1.0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : null;
};

type Named = { use: string; spdx: string };
const termsOf = (spdx: string) => spdx.match(/-(BY|SA|NC|ND)\b/g)?.length ?? 0;
const moreRestrictive = (a: Named, b: Named) =>
  (Number(a.use === "personal_study") - Number(b.use === "personal_study") ||
    termsOf(a.spdx) - termsOf(b.spdx)) > 0;

export function imageLicence(info: FileInfo, fileUrl: string): ImageLicence {
  const [first, ...rest] = info.licences.map((name) => ({
    name,
    ...(PUBLIC_DOMAIN.test(name)
      ? { spdx: "LicenseRef-PublicDomain", use: "open" as const }
      : classifyLicence(name, fileUrl)),
  }));
  if (!first) {
    return {
      ok: false,
      reason: "its file page states no licence code can read",
      reason_ar: "لا تذكر صفحة ملفه ترخيصًا يقرؤه الكود",
    };
  }
  const off = [first, ...rest].find((n) => n.use === "rejected");
  if (off) {
    return {
      ok: false,
      reason: `its file page states ${off.name}, which is not on the allowlist`,
      reason_ar: "ترخيصه في صفحة ملفه ليس من التراخيص المقبولة",
    };
  }
  const cited = rest.reduce((a, b) => (moreRestrictive(b, a) ? b : a), first);
  if (/^CC-BY/.test(cited.spdx) && !info.author) {
    return {
      ok: false,
      reason: `${cited.name} needs an author to credit, and its file page names none`,
      reason_ar: "يشترط ترخيصه ذكر المؤلف، ولا تذكره صفحة ملفه",
    };
  }
  return {
    ok: true,
    spdx: cited.spdx,
    name: cited.name,
    url: deedOf(cited.spdx),
    adapt: cited.use === "open" && ADAPTABLE.test(cited.spdx),
  };
}
