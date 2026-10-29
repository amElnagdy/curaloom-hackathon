// The licence checker (#17). It reads the licence statements in a page's own text and maps them to
// one SPDX id and a use. A model's claim about a licence is not evidence, so only this code decides.

import type { Resource } from "../../../../contracts/index.ts";

type Use = Resource["licence"]["use"];

export type LicenceCheck = {
  spdx: string;
  use: Use | "rejected";
  evidence_url: string;
  // The statement as it appears in the page text, cut at sentence ends; "…" marks a cut mid-sentence.
  quote: string;
  reason: string;
  reason_ar: string;
};

// Patterns compile with the "giu" flags. JavaScript's \b only knows ASCII letters, so a pattern
// that must not run into a neighbouring word uses these edges, which know every script.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const VERSION = String.raw`(?<v>[1-4]\.[05])`;

// Creative Commons terms in the words that English, French, Russian and Chinese pages use. NC and ND
// limit reuse, so a licence with either one is for personal study only.
const CC_TERMS = {
  BY: {
    personalOnly: false,
    words: ["Attribution", "Paternité", "Атрибуция", "С указанием авторства", "署名"],
  },
  SA: {
    personalOnly: false,
    words: [
      "Share-?Alike",
      "Partage dans les m[êe]mes conditions",
      "С сохранением условий",
      "(?:Распространение )?На тех же условиях",
      "СохранениеУсловий",
      "相同方式共享",
      "相同方式分享",
    ],
  },
  NC: {
    personalOnly: true,
    words: [
      "Non-?Commercial",
      "Pas d.utilisation commerciale",
      "Некоммерческое использование",
      "НеКоммерческое",
      "非商业性使用",
      "非商業性",
    ],
  },
  ND: {
    personalOnly: true,
    words: [
      "No-?Deriv(?:ative)?s",
      "Pas de modification",
      "Без производных(?: произведений)?",
      "БезПроизводных",
      "禁止演绎",
      "禁止改作",
    ],
  },
} as const;
type CcTerm = keyof typeof CC_TERMS;

const CC_LICENCES: CcTerm[][] = [
  ["BY"],
  ["BY", "SA"],
  ["BY", "NC"],
  ["BY", "ND"],
  ["BY", "NC", "SA"],
  ["BY", "NC", "ND"],
];

// A row's patterns run in preference order: the quote comes from the earliest one that matched.
type LicenceRow = {
  kind: "licence";
  family: string;
  spdx: string;
  use: Use;
  // The patterns capture a version (`v`) that completes the SPDX id, e.g. CC-BY-SA + 4.0.
  versioned?: true;
  // Says less than any other licence in its family, so a more specific one replaces it.
  generic?: true;
  // A software licence. Beside a content licence it covers a page's code samples, not its text.
  code?: true;
  // How many Creative Commons terms the licence carries (BY is one). Of two content licences on a
  // page, the one with more binds the reuse of the page.
  terms?: number;
  patterns: string[];
};
type Row =
  | LicenceRow
  | { kind: "not_allowed"; family: string; spdx: string; patterns: string[] }
  | { kind: "reserved"; patterns: string[] }
  // An NC or ND term outside any licence statement: it limits whatever licence the page states.
  | { kind: "restriction"; patterns: string[] }
  | { kind: "vague"; patterns: string[] };

function ccRow(terms: CcTerm[]): LicenceRow {
  const code = terms.join("-");
  const words = (term: CcTerm) => `(?:${CC_TERMS[term].words.join("|")})`;
  const short = terms.join(String.raw`[-\s]?`);
  return {
    kind: "licence",
    family: `CC-${code}`,
    spdx: `CC-${code}`,
    use: terms.some((term) => CC_TERMS[term].personalOnly) ? "personal_study" : "open",
    versioned: true,
    terms: terms.length,
    patterns: [
      String.raw`(?:Creative\s*Commons|知识共享|知識共享)\s*[«"“„]?\s*${terms.map(words).join(String.raw`\s*[-–—,]?\s*`)}\s*[»"”]?(?:\s*${VERSION})?`,
      String.raw`${START}CC[-\s]?${short}(?:[-\s]${VERSION})?${END}`,
      String.raw`${START}CC[-\s]?${VERSION}[-\s]?${short}${END}`,
      String.raw`creativecommons\.org/licenses/${code.toLowerCase()}(?![\w-])(?:/${VERSION})?`,
    ],
  };
}

// Allowlist: CC BY, CC BY-SA, CC0, MIT, Apache 2.0 and public domain are open; the CC licences with
// NC or ND are for personal study. A page may name several, all on the allowlist; a page that names
// anything else is rejected.
const ROWS: Row[] = [
  ...CC_LICENCES.map(ccRow),
  {
    kind: "licence",
    family: "public-domain",
    spdx: "CC0-1.0",
    use: "open",
    patterns: [
      String.raw`CC0\s*1\.0(?:\s*(?:Universal|通用))?`,
      String.raw`Creative\s*Commons\s*Zero`,
      `${START}CC0${END}`,
      String.raw`creativecommons\.org/publicdomain/zero/1\.0`,
    ],
  },
  {
    kind: "licence",
    family: "public-domain",
    spdx: "LicenseRef-PublicDomain",
    use: "open",
    generic: true,
    patterns: [
      String.raw`(?:released|dedicated|placed)\s+(?:in|into|to)\s+the\s+public\s+domain`,
      String.raw`(?:is|are|remains?)\s+in\s+the\s+public\s+domain`,
      String.raw`public\s+domain\s+(?:dedication|mark)`,
      String.raw`общественн\p{L}{0,3}\s+достояни\p{L}{0,3}`,
      String.raw`domaine\s+public`,
      "公有领域|公共领域|公有領域",
      String.raw`creativecommons\.org/publicdomain/mark`,
    ],
  },
  {
    kind: "licence",
    family: "MIT",
    spdx: "MIT",
    use: "open",
    code: true,
    patterns: [
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
      String.raw`${START}MIT\s+licen[cs]e${END}`,
      String.raw`licen[cs]ed\s+under\s+(?:the\s+)?MIT${END}`,
      String.raw`SPDX-License-Identifier:\s*MIT${END}`,
    ],
  },
  {
    kind: "licence",
    family: "Apache-2.0",
    spdx: "Apache-2.0",
    use: "open",
    code: true,
    patterns: [
      String.raw`Apache\s+Licen[cs]e,?\s+(?:Version\s+)?2\.0`,
      String.raw`apache\.org/licenses/LICENSE-2\.0`,
      String.raw`${START}Apache[-\s]2\.0${END}`,
    ],
  },
  {
    kind: "not_allowed",
    family: "MPL-2.0",
    spdx: "MPL-2.0",
    patterns: [
      String.raw`Mozilla\s+Public\s+Licen[cs]e,?\s*(?:v(?:ersion)?\.?\s*)?2\.0`,
      String.raw`${START}MPL[-\s]?2\.0${END}`,
    ],
  },
  {
    kind: "not_allowed",
    family: "GFDL",
    spdx: "GFDL",
    patterns: [String.raw`GNU\s+Free\s+Documentation\s+Licen[cs]e`, `${START}GFDL${END}`],
  },
  {
    kind: "not_allowed",
    family: "GPL",
    spdx: "GPL",
    patterns: [
      String.raw`GNU\s+(?:Lesser\s+|Affero\s+)?General\s+Public\s+Licen[cs]e`,
      `${START}[AL]?GPL(?:-?v?[23])?${END}`,
    ],
  },
  {
    kind: "not_allowed",
    family: "BSD",
    spdx: "BSD",
    patterns: [
      String.raw`${START}BSD[-\s]?[234][-\s]?Clause${END}`,
      String.raw`${START}BSD\s+licen[cs]e${END}`,
    ],
  },
  {
    kind: "reserved",
    patterns: [
      String.raw`all\s+rights\s+reserved`,
      String.raw`все\s+права\s+защищены`,
      String.raw`tous\s+droits\s+r[ée]serv[ée]s`,
      "版权所有|版權所有|保留所有权利|保留所有權利|著作权归作者所有|著作權歸作者所有",
    ],
  },
  {
    kind: "restriction",
    patterns: [...CC_TERMS.NC.words, ...CC_TERMS.ND.words].map((w) => `${START}(?:${w})${END}`),
  },
  {
    kind: "vague",
    patterns: [
      String.raw`Creative\s*Commons`,
      "知识共享|知識共享",
      String.raw`open(?:ly)?\s+licen[cs]ed?`,
      String.raw`open\s+educational\s+resources?`,
      `${START}OER${END}`,
      String.raw`licence\s+(?:libre|ouverte)`,
      String.raw`свободн\p{L}{0,3}\s+лицензи\p{L}{0,3}`,
      "开放许可|開放授權",
    ],
  },
];

const COMPILED = ROWS.map((row) => ({
  row,
  patterns: row.patterns.map((pattern) => new RegExp(pattern, "giu")),
}));

type Finding = { row: Row; rank: number; start: number; end: number; version?: string };

// Page text is untrusted, and the whole of it counts: a restrictive term anywhere limits the page.
// So every step is linear or n log n in the text: a page at the fetcher's 512 KB cap classifies in
// about 20 ms, hostile ones included (licence.test.ts). Whitespace is collapsed first, so the
// patterns' adjacent `\s*` cannot backtrack over a long run.
function findStatements(text: string): Finding[] {
  const found: Finding[] = [];
  for (const { row, patterns } of COMPILED) {
    patterns.forEach((re, rank) => {
      for (const m of text.matchAll(re)) {
        found.push({ row, rank, start: m.index, end: m.index + m[0].length, version: m.groups?.v });
      }
    });
  }
  // A statement inside a longer one ("CC BY" in "CC BY-SA 4.0") is part of it, not a second licence.
  // Sorted by start, longest first, a statement is inside an earlier one exactly when an earlier
  // one reaches its end. Past that, only the first statement per pattern and version matters.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  let reach = -1;
  const seen = new Set<string>();
  return found.filter((f) => {
    const inside = f.end <= reach;
    reach = Math.max(reach, f.end);
    const key = `${ROWS.indexOf(f.row)}:${f.rank}:${f.version ?? ""}`;
    if (inside || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type NamingRow = Extract<Row, { family: string }>;
type Naming = Finding & { row: NamingRow };
const names = (f: Finding): f is Naming => "family" in f.row;

function idOf({ row, version }: Naming): { spdx: string; generic: boolean } {
  if (row.kind === "licence" && row.versioned) {
    return { spdx: version ? `${row.spdx}-${version}` : row.spdx, generic: !version };
  }
  return { spdx: row.spdx, generic: row.kind === "licence" && row.generic === true };
}

// One licence the page names, with every statement of its family. Within a family, a generic
// statement ("CC BY-SA", "public domain") merges into a specific one ("CC BY-SA 4.0", "CC0 1.0").
type Named = { spdx: string; row: NamingRow; findings: Finding[] };

function namedLicences(findings: Finding[]): Named[] {
  const families = new Map<string, Naming[]>();
  for (const f of findings.filter(names)) {
    const family = families.get(f.row.family);
    if (family) family.push(f);
    else families.set(f.row.family, [f]);
  }
  return [...families.values()].flatMap((family) => {
    const ids = family.map((f) => ({ ...idOf(f), row: f.row }));
    const specific = ids.filter((id) => !id.generic);
    const kept = new Map((specific.length ? specific : ids).map((id) => [id.spdx, id.row]));
    return [...kept].map(([spdx, row]) => ({ spdx, row, findings: family }));
  });
}

type Allowed = Named & { row: LicenceRow };
const allowed = (n: Named): n is Allowed => n.row.kind === "licence";

// Of the allowed licences a page names, the one its resource cites comes first: a content licence
// before a code one (docs often license their code samples apart), then a personal-study one
// before an open one, then the one with more CC terms. A tie keeps the order of the page.
const citedFirst = (a: Allowed, b: Allowed) =>
  Number(a.row.code === true) - Number(b.row.code === true) ||
  Number(b.row.use === "personal_study") - Number(a.row.use === "personal_study") ||
  (b.row.terms ?? 0) - (a.row.terms ?? 0);

const SENTENCE_END = /^[\s\S]*(?:[.!?;](?=\s)|[。！？；])\s*/u;
const SENTENCE = /^[\s\S]*?(?:[.!?;](?=\s|$)|[。！？；]|$)/u;

// The sentence around a statement, verbatim, at most about 120 characters either side.
function quoteOf(text: string, findings: Finding[]): string {
  const best = findings.toSorted(
    (a, b) => a.rank - b.rank || b.end - b.start - (a.end - a.start),
  )[0];
  if (!best) return "";
  const before = text.slice(Math.max(0, best.start - 120), best.start);
  const head = before.replace(SENTENCE_END, "");
  const cutHead = head === before && best.start > 120;
  const tail = SENTENCE.exec(text.slice(best.end, best.end + 120))?.[0] ?? "";
  const cutTail = !/[.!?;。！？；]$/u.test(tail) && best.end + tail.length < text.length;
  const quote = (head + text.slice(best.start, best.end) + tail).trim();
  return `${cutHead ? "…" : ""}${quote}${cutTail ? "…" : ""}`;
}

export function classifyLicence(pageText: string, url: string): LicenceCheck {
  const text = pageText.replace(/\s+/g, " ");
  const findings = findStatements(text);
  const named = namedLicences(findings);
  const reserved = findings.filter((f) => f.row.kind === "reserved");
  const restriction = findings.find((f) => f.row.kind === "restriction");
  const vague = findings.filter((f) => f.row.kind === "vague");
  const rejected = (spdx: string, quoted: Finding[], reason: string, reason_ar: string) => ({
    spdx,
    use: "rejected" as const,
    evidence_url: url,
    quote: quoteOf(text, quoted),
    reason,
    reason_ar,
  });

  const offList = named.find((n) => n.row.kind === "not_allowed");
  if (offList) {
    return rejected(
      offList.spdx,
      offList.findings,
      `${offList.spdx} is not on the allowlist`,
      `ترخيصه ${offList.spdx} ليس من التراخيص المقبولة`,
    );
  }
  const [cited, ...others] = named.filter(allowed).toSorted(citedFirst);
  if (cited && reserved.length) {
    return rejected(
      "NOASSERTION",
      cited.findings,
      `${cited.spdx} stated alongside "all rights reserved"`,
      "تذكر صفحته ترخيصًا مفتوحًا وعبارة «جميع الحقوق محفوظة» معًا",
    );
  }
  if (cited) {
    // Sorted so, the cited licence is personal_study whenever any licence on the page is.
    const limit = cited.row.use === "open" ? restriction : undefined;
    const ids = others.map((n) => n.spdx);
    return {
      spdx: cited.spdx,
      use: limit ? "personal_study" : cited.row.use,
      evidence_url: url,
      quote: quoteOf(text, cited.findings),
      reason:
        (limit
          ? `the page states ${cited.spdx} but limits reuse elsewhere ("${text.slice(limit.start, limit.end)}")`
          : `the page states ${cited.spdx}`) + (ids.length ? `, and also ${ids.join(", ")}` : ""),
      reason_ar:
        (limit
          ? `تذكر صفحته ترخيص ${cited.spdx}، لكنها تقيّد إعادة الاستخدام في موضع آخر`
          : `تذكر صفحته ترخيص ${cited.spdx}`) + (ids.length ? `، ومعه ${ids.join("، ")}` : ""),
    };
  }
  if (reserved.length) {
    return rejected(
      "NOASSERTION",
      reserved,
      "all rights reserved",
      "تقول صفحته «جميع الحقوق محفوظة»",
    );
  }
  if (vague.length) {
    return rejected(
      "NOASSERTION",
      vague,
      "names an open licence without its terms",
      "تذكر صفحته ترخيصًا مفتوحًا دون أن تحدد شروطه",
    );
  }
  return rejected("NOASSERTION", [], "no licence statement found", "لا تذكر صفحته أي ترخيص");
}
