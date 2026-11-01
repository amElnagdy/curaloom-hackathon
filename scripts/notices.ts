// `pnpm notices` writes THIRD_PARTY_NOTICES.md from what the repo holds: the installed npm packages
// (`pnpm licenses list`), the fonts `src/app/layout.tsx` loads, the lucide icons `src/` imports, and
// the source pages, images and model calls recorded in `demo/fixtures/`. Each recorded page's
// licence comes from the scout's own checker, each image's from the diagrams agent's, and each
// credit line from the lesson page's. Run it again after a dependency, font, icon or fixture change.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { creditLine } from "../src/app/_shell/format.ts";
import { config } from "../src/config.ts";
import { fileInfoOf, fileTitle, imageLicence } from "../src/server/agents/diagrams/wiki.ts";
import { EXCERPT_WORDS } from "../src/server/agents/lesson/rules.ts";
import { classifyLicence } from "../src/server/agents/scout/licence.ts";
import { normalizeResponses } from "../src/server/providers/meta.ts";

const ROOT = process.cwd();
const OUT = "THIRD_PARTY_NOTICES.md";
const PAGES = "demo/fixtures/pages";
const RESPONSES = "demo/fixtures/responses";

// next/font/google does not carry a font's licence, so each family the layout loads needs a row.
const FONT_LICENCES: Record<string, string> = {
  "Noto Sans": "OFL-1.1",
  "Noto Sans Arabic": "OFL-1.1",
  "Noto Sans SC": "OFL-1.1",
};

// A recorded call carries a page's text when it holds a run of words that only that page holds. The
// run is as long as the shortest excerpt a lesson may quote, which is longer than a page title or
// the one-sentence description of a page that a search reply gives.
const RUN_WORDS = EXCERPT_WORDS.min;
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
// A Chinese or Japanese character counts as a word, as the lesson rules count them.
const WORD = new RegExp(`[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}])+`, "gu");

// Who to credit when the licence statement does not name the authors.
const AUTHORS: [RegExp, string][] = [
  [/(^|\.)wikipedia\.org$/, "Wikipedia contributors"],
  [/(^|\.)wikibooks\.org$/, "Wikibooks contributors"],
];

const LANGUAGES: Record<string, string> = {
  English: "en",
  Russian: "ru",
  Chinese: "zh",
  French: "fr",
};

type InstalledPackage = { name: string; versions: string[]; license: string; homepage?: string };

type RecordedCall = {
  request: {
    path: string;
    json?: { text?: { format?: { name?: string } }; tools?: { type: string }[] };
  };
  body: unknown;
};

type RecordedPage = {
  file: string;
  url: string;
  response:
    | { kind: "page"; status: number; truncated: boolean; text: string }
    | { kind: "html"; status: number; truncated: boolean; html: string }
    | { kind: "image"; status: number; content_type: string; b64: string }
    | { kind: "redirect"; status: number; location: string }
    | { kind: "failed"; reason: string };
};

type Cited = { title: string; lang?: string };

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
const isFilePage = (url: string) => /^\/wiki\/File:/.test(URL.parse(url)?.pathname ?? "");

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;
const spdxUrl = (id: string) => `https://spdx.org/licenses/${id}.html`;
const cell = (text: string) => text.replaceAll("|", "\\|");

// The form two spellings of one URL share, as the scout compares them.
function normalUrl(url: string): string {
  const parsed = URL.parse(url.trim());
  if (!parsed) return url.trim();
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
}

function installedPackages(): InstalledPackage[] {
  const run = spawnSync("pnpm", ["licenses", "list", "--json"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`pnpm licenses list failed: ${run.stderr}`);
  const byLicence = JSON.parse(run.stdout) as Record<string, InstalledPackage[]>;
  return Object.values(byLicence)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function dependencySection(installed: InstalledPackage[]): string[] {
  const manifest = readJson<Record<string, Record<string, string> | undefined>>("package.json");
  const direct = [
    ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, kind: "runtime" })),
    ...Object.keys(manifest.devDependencies ?? {}).map((name) => ({ name, kind: "dev" })),
  ];
  const rows = direct.map(({ name, kind }) => {
    const pkg = installed.find((p) => p.name === name);
    if (!pkg) throw new Error(`${name} is not installed; run pnpm install first`);
    return `| ${name} | ${pkg.versions.join(", ")} | ${pkg.license} | ${kind} | ${pkg.homepage ?? ""} |`;
  });
  const licences = [...new Set(installed.map((p) => p.license))].sort();
  const groups = licences.map((licence) => {
    const names = installed
      .filter((p) => p.license === licence)
      .map((p) => `${p.name}@${p.versions.join("/")}`);
    return `| ${cell(licence)} | ${names.length} | ${names.join(", ")} |`;
  });
  return [
    "## npm packages",
    "",
    "Direct dependencies from `package.json`, with the licence each installed package declares:",
    "",
    "| Package | Version | Licence | Kind | Homepage |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `Every installed package, direct or transitive, by declared licence (${installed.length} packages, from \`pnpm licenses list\` on ${process.platform}-${process.arch}). Platform-specific optional packages, such as the compiler and image binaries, differ on other systems.`,
    "",
    "| Licence | Count | Packages |",
    "| --- | --- | --- |",
    ...groups,
    "",
  ];
}

function fontSection(): string[] {
  const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
  const imported = layout.match(/import\s*\{([^}]+)\}\s*from\s*"next\/font\/google"/)?.[1] ?? "";
  const families = imported
    .split(",")
    .map((name) => name.trim().replaceAll("_", " "))
    .filter(Boolean);
  const rows = families.map((family) => {
    const licence = FONT_LICENCES[family];
    if (!licence) throw new Error(`Add the licence of ${family} to FONT_LICENCES`);
    const specimen = `https://fonts.google.com/specimen/${family.replaceAll(" ", "+")}`;
    return `| ${family} | ${licence} | ${specimen} |`;
  });
  return [
    "## Fonts",
    "",
    "`src/app/layout.tsx` loads these through `next/font/google`, which downloads them at build time and serves them from the app (ADR-007).",
    "",
    "| Font | Licence | Source |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `SIL Open Font License 1.1: ${spdxUrl("OFL-1.1")}`,
    "",
  ];
}

function iconSection(installed: InstalledPackage[]): string[] {
  const lucide = installed.find((p) => p.name === "lucide-react");
  if (!lucide) throw new Error("lucide-react is not installed; run pnpm install first");
  const licence = readFileSync(join(ROOT, "node_modules/lucide-react/LICENSE"), "utf8");
  const feather = new Set(
    (licence.match(/derived from the Feather project:\s*\n\s*\n([^\n]+)/)?.[1] ?? "")
      .split(",")
      .map((name) => name.trim()),
  );
  const used = new Set<string>();
  const sources = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" }).filter(
    (file) => /\.tsx?$/.test(file),
  );
  for (const file of sources) {
    const text = readFileSync(join(ROOT, "src", file), "utf8");
    for (const [, names] of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/g)) {
      for (const name of (names ?? "").split(",").map((n) => n.trim())) {
        if (name && !name.startsWith("type ")) used.add(name);
      }
    }
  }
  const icons = [...used].sort();
  const kebab = (name: string) =>
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([a-zA-Z])(\d)/g, "$1-$2")
      .toLowerCase();
  const fromFeather = icons.filter((name) => feather.has(kebab(name)));
  return [
    "## Icons",
    "",
    `lucide-react ${lucide.versions.join(", ")} (${lucide.homepage ?? ""}), licence ${lucide.license}. \`src/\` uses ${icons.length} of its icons: ${icons.join(", ")}.`,
    "",
    `Lucide's licence file marks some icons as derived from Feather, under the MIT licence, Copyright (c) 2013-present Cole Bemis. ${fromFeather.length} of the icons used are among them: ${fromFeather.join(", ")}.`,
    "",
  ];
}

// Each recorded page, with the title and language its web search cited it with.
function citedPages(): Map<string, Cited> {
  const cited = new Map<string, Cited>();
  for (const file of readdirSync(join(ROOT, RESPONSES))) {
    const fixture = readJson<{ request: { json?: { input?: unknown } }; body: unknown }>(
      `${RESPONSES}/${file}`,
    );
    const input = fixture.request.json?.input;
    const language = typeof input === "string" ? input.match(/^Language: (\w+)/)?.[1] : undefined;
    for (const citation of normalizeResponses(fixture.body).citations) {
      const key = normalUrl(citation.url);
      if (cited.has(key) || !citation.title) continue;
      cited.set(key, { title: citation.title, lang: language && LANGUAGES[language] });
    }
  }
  return cited;
}

const recordedPages = (): RecordedPage[] =>
  readdirSync(join(ROOT, PAGES))
    .sort()
    .map((file) => ({ ...readJson<Omit<RecordedPage, "file">>(`${PAGES}/${file}`), file }));

const recordedCalls = (): string[] =>
  readdirSync(join(ROOT, RESPONSES)).map((file) =>
    readFileSync(join(ROOT, RESPONSES, file), "utf8"),
  );

const isRobots = (url: string) => URL.parse(url)?.pathname === "/robots.txt";

// Each recorded page that holds text, with its licence, its title and the calls that name it.
function recordedSources(recorded: RecordedPage[], recordings: string[]) {
  const redirects = new Map(
    recorded.flatMap((p) => (p.response.kind === "redirect" ? [[p.url, p.response.location]] : [])),
  );
  const finalUrl = (url: string): string => {
    let at = url;
    for (let hop = 0; hop < 5 && redirects.has(at); hop++) at = redirects.get(at) as string;
    return at;
  };
  const cited = citedPages();
  const titleOf = (url: string) =>
    cited.get(normalUrl(url)) ??
    [...redirects.keys()]
      .filter((from) => finalUrl(from) === url)
      .map((from) => cited.get(normalUrl(from)))
      .find(Boolean);
  const htmlCopies = recorded.filter((p) => p.response.kind === "html" && !isFilePage(p.url));

  return recorded.flatMap((page) => {
    if (page.response.kind !== "page" || !page.response.text || isRobots(page.url)) return [];
    const text = page.response.text;
    const check = classifyLicence(text, page.url);
    const host = URL.parse(page.url)?.hostname ?? "";
    const seen = titleOf(page.url);
    const spellings = [page.url, ...[...redirects.keys()].filter((u) => finalUrl(u) === page.url)];
    const forms = [...new Set(spellings.flatMap((u) => [u, decodeURI(u)]))];
    // The scout names a resource by a hash of the URL the model cited, in any of these spellings.
    const ids = forms.map((u) => `r_${createHash("sha256").update(u).digest("hex").slice(0, 8)}`);
    const named = recordings.filter((r) => [...forms, ...ids].some((form) => r.includes(form)));
    const quoted = named.filter((r) => ids.some((id) => r.includes(`### ${id} |`)));
    const html = htmlCopies.filter((h) => forms.includes(finalUrl(h.url)));
    return [
      {
        page,
        text,
        check,
        title: seen?.title ?? host,
        lang: seen?.lang,
        authors: AUTHORS.find(([pattern]) => pattern.test(host))?.[1],
        named: named.length,
        quoted: quoted.length,
        html,
      },
    ];
  });
}

type Source = ReturnType<typeof recordedSources>[number];

function sourceSection(recorded: RecordedPage[], sources: Source[]): string[] {
  const withText = sources.map((s) => s.page);
  const redirects = new Set(
    recorded.flatMap((p) => (p.response.kind === "redirect" ? [p.url] : [])),
  );
  const robots = recorded.filter((p) => p.response.kind === "page" && isRobots(p.url));
  const media = recorded.filter((p) => isFilePage(p.url) || p.response.kind === "image");
  const paired = new Set(sources.flatMap((s) => s.html));
  const empty = recorded.filter(
    (p) =>
      p.response.kind !== "redirect" &&
      !isRobots(p.url) &&
      !withText.includes(p) &&
      !paired.has(p) &&
      !media.includes(p),
  );

  const use = (s: Source) =>
    s.check.use === "rejected"
      ? `rejected by the checker: ${s.check.reason}`
      : s.check.use === "personal_study"
        ? "personal study only (NonCommercial or NoDerivatives)"
        : "open";
  const rows = sources.map(
    (s) => `| ${cell(s.title)} | ${s.lang ?? ""} | ${s.check.spdx} | ${cell(use(s))} |`,
  );
  const entries = sources.flatMap((s) => [
    `### ${s.title}`,
    "",
    `- URL: ${decodeURI(s.page.url)}`,
    ...(s.authors ? [`- Authors: ${s.authors}`] : []),
    `- Licence: ${s.check.spdx}, ${spdxUrl(s.check.spdx)}. Use: ${use(s)}.`,
    `- Licence statement on the page: "${s.check.quote}"`,
    `- Stored copy: \`${PAGES}/${s.page.file}\`, the page's text as fetched${s.page.response.kind === "page" && s.page.response.truncated ? ", cut at the fetcher's byte cap" : ""}.`,
    ...s.html.map(
      (h) =>
        `- Stored HTML copy: \`${PAGES}/${h.file}\`, the whole page as fetched, which the diagrams agent reads for its figures.`,
    ),
    `- Recorded model calls that name it: ${s.named}. Lesson-writing calls that quote its text: ${s.quoted}.`,
    ...(s.check.use === "rejected"
      ? []
      : [
          `- Credit line the lesson page copies: ${creditLine({ ...s, url: decodeURI(s.page.url), licence: s.check }, config.appName)}`,
        ]),
    "",
  ]);

  return [
    "## Recorded source pages",
    "",
    `The replay demo reads web pages from \`${PAGES}/\` instead of the network. ${withText.length} of those files hold the text of a third-party page. Each licence below is what the scout's checker (\`src/server/agents/scout/licence.ts\`) finds in the stored text. The recorded lesson-writing calls in \`${RESPONSES}/\` quote excerpts of some of these pages, and the Arabic lessons in their replies are built on those excerpts, with changes.`,
    "",
    "| Source | Language | Licence | Use |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    ...entries,
    "The other files in that folder hold no page text:",
    "",
    `- ${robots.length} robots.txt files, read to check that a site allows the fetch.`,
    `- ${redirects.size} redirects, URL to URL.`,
    ...empty.map(
      (p) =>
        `- ${decodeURI(p.url)}: ${p.response.kind === "page" || p.response.kind === "html" ? `HTTP ${p.response.status}, no text stored` : `not fetched (${p.response.kind === "failed" ? p.response.reason : p.response.kind})`}.`,
    ),
    `- ${media.length} files for the images below.`,
    "",
  ];
}

// Each image file page the diagrams agent read, with the licence its own check finds there.
function imageSection(recorded: RecordedPage[], recordings: string[]): string[] {
  const images = recorded.filter((p) => p.response.kind === "image");
  const filePages = recorded.filter((p) => p.response.kind === "html" && isFilePage(p.url));
  const entries = filePages.flatMap((page) => {
    const info = fileInfoOf(page.response.kind === "html" ? page.response.html : "", page.url);
    const licence = imageLicence(info, page.url);
    const image = images.find((i) => i.url === info.image_url);
    const sent =
      image?.response.kind === "image"
        ? `data-url-sha256:${sha256(`data:${image.response.content_type};base64,${image.response.b64}`)}`
        : null;
    const calls = sent ? recordings.filter((r) => r.includes(sent)) : [];
    const edits = calls.filter((r) => r.includes('"path": "/images/edits"'));
    return [
      `### ${fileTitle(page.url)}`,
      "",
      `- File page: ${decodeURI(page.url)}`,
      ...(info.author ? [`- Author, as the file page names it: ${info.author}`] : []),
      licence.ok
        ? `- Licence: ${licence.name}${licence.url ? `, ${licence.url}` : ""}. The app ${licence.adapt ? "may relabel it" : "shows it unedited"}.`
        : `- Not used: ${licence.reason}.`,
      `- Stored copies: \`${PAGES}/${page.file}\`, the file page's HTML${image ? `, and \`${PAGES}/${image.file}\`, the image` : ""}.`,
      ...(image
        ? [
            `- Recorded model calls that send the image: ${calls.length}. Muse Image edits among them: ${edits.length}, and each edit's reply holds a relabelled copy of the image.`,
          ]
        : []),
      "",
    ];
  });
  return [
    "## Recorded images",
    "",
    `The diagrams agent reads each image's licence and author from its file page, and code decides whether the app may relabel it. The replay demo reads these file pages and images from \`${PAGES}/\`.`,
    "",
    ...entries,
  ];
}

const wordRuns = (text: string): string[] => {
  const words = text.normalize("NFKC").toLowerCase().match(WORD) ?? [];
  return Array.from({ length: Math.max(0, words.length - RUN_WORDS + 1) }, (_, i) =>
    words.slice(i, i + RUN_WORDS).join(" "),
  );
};

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

function modelSection(sources: Source[]): string[] {
  const files = readdirSync(join(ROOT, RESPONSES)).sort();
  const models = new Map<string, number>();
  for (const file of files) {
    const model = file.match(/^[a-z_]+-(.+)-[0-9a-f]{16}\.json$/)?.[1] ?? "unknown";
    models.set(model, (models.get(model) ?? 0) + 1);
  }
  const modelCounts = [...models]
    .sort()
    .map(([model, n]) => `${n} from ${model}`)
    .join(", ");

  // Each run of words that one page holds and no other page does, by that page.
  const owner = new Map<string, Source | null>();
  for (const source of sources) {
    for (const run of wordRuns(source.text)) {
      owner.set(run, owner.has(run) && owner.get(run) !== source ? null : source);
    }
  }
  const carriers = files.flatMap((file) => {
    const call = readJson<RecordedCall>(`${RESPONSES}/${file}`);
    const searched = call.request.json?.tools?.some((tool) => tool.type === "web_search");
    const read = [...strings(call.request.json), ...(searched ? strings(call.body) : [])];
    const found = new Set(read.flatMap(wordRuns).map((run) => owner.get(run)));
    const carried = sources.filter((s) => found.has(s));
    const kind = call.request.json?.text?.format?.name ?? call.request.path;
    return carried.length ? [{ file, kind, carried }] : [];
  });
  const uncarried = sources.filter((s) => !carriers.some((c) => c.carried.includes(s)));
  const titled = (s: Source) => `${s.title} (${s.check.spdx})`;

  return [
    "## Recorded model replies",
    "",
    `\`${RESPONSES}/\` holds ${files.length} recorded Meta Model API calls: ${modelCounts}. Each file keeps the request and the model's reply.`,
    "",
    `The repository's code licence does not cover these files, as [\`demo/fixtures/LICENSE.md\`](demo/fixtures/LICENSE.md) explains. A file that carries the text of a recorded page keeps that page's licence. Its request holds the text, and the model wrote its reply from it. A call carries a page's text when it holds a run of ${RUN_WORDS} words that this page holds and no other recorded page does, counting a Chinese character as one word. The check reads every request, and every web search's reply too, since a search opens pages its request does not hold. Each page's entry under "Recorded source pages" names its authors and its licence statement.`,
    "",
    `${carriers.length} calls carry page text:`,
    "",
    ...carriers.map((c) => `- \`${c.file}\` (${c.kind}): ${c.carried.map(titled).join(", ")}.`),
    "",
    ...(uncarried.length
      ? [`No call carries the text of ${uncarried.map(titled).join(", ")}.`, ""]
      : []),
    `The other ${files.length - carriers.length} calls carry no page text, so no page licence applies to them.`,
    "",
  ];
}

const installed = installedPackages();
const pages = recordedPages();
const recordings = recordedCalls();
const sources = recordedSources(pages, recordings);
const lines = [
  "# Third-party notices",
  "",
  "Generated by `pnpm notices` (`scripts/notices.ts`). Do not edit by hand. Run it again after a dependency, font, icon or fixture change.",
  "",
  `${config.appName} is a working name, read from \`src/config.ts\`. It appears below only where the app writes it into a credit line.`,
  "",
  ...dependencySection(installed),
  ...fontSection(),
  ...iconSection(installed),
  ...sourceSection(pages, sources),
  ...imageSection(pages, recordings),
  ...modelSection(sources),
];
writeFileSync(join(ROOT, OUT), `${lines.join("\n").trimEnd()}\n`);
const format = spawnSync("pnpm", ["exec", "biome", "format", "--write", OUT], { stdio: "inherit" });
if (format.status !== 0) process.exit(format.status ?? 1);
console.log(`Wrote ${OUT}`);
