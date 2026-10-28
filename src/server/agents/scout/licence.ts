// The licence checker (#17). It reads the licence statement in a page's own text and maps it to an
// SPDX id and a use. A model's claim about a licence is not evidence, so only this code decides.

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
  patterns: string[];
};
type Row =
  | LicenceRow
  | { kind: "not_allowed"; family: string; spdx: string; patterns: string[] }
  | { kind: "reserved"; patterns: string[] }
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
    patterns: [
      String.raw`(?:Creative\s*Commons|知识共享|知識共享)\s*[«"“„]?\s*${terms.map(words).join(String.raw`\s*[-–—,]?\s*`)}\s*[»"”]?(?:\s*${VERSION})?`,
      String.raw`${START}CC[-\s]?${short}(?:[-\s]${VERSION})?${END}`,
      String.raw`${START}CC[-\s]?${VERSION}[-\s]?${short}${END}`,
      String.raw`creativecommons\.org/licenses/${code.toLowerCase()}(?![\w-])(?:/${VERSION})?`,
    ],
  };
}

// Allowlist: CC BY, CC BY-SA, CC0, MIT, Apache 2.0 and public domain are open; the CC licences with
// NC or ND are for personal study. Everything else is rejected.
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

// Page text is untrusted, so the work per page is bounded. Licence statements sit in a page's head
// (a rel="license" link) and its footer, so only those ends are read. Collapsing whitespace keeps the
// patterns' adjacent `\s*` from backtracking over a long run, and a page that states its licence
// more often than MAX_PER_PATTERN times says nothing new after that.
const EDGE_CHARS = 64 * 1024;
const MAX_PER_PATTERN = 25;

function edgesOf(text: string): string {
  const edges =
    text.length > 2 * EDGE_CHARS ? `${text.slice(0, EDGE_CHARS)} ${text.slice(-EDGE_CHARS)}` : text;
  return edges.replace(/\s+/g, " ");
}

type Finding = { row: Row; rank: number; start: number; end: number; version?: string };

function findStatements(text: string): Finding[] {
  const found: Finding[] = [];
  for (const { row, patterns } of COMPILED) {
    patterns.forEach((re, rank) => {
      let count = 0;
      for (const m of text.matchAll(re)) {
        const end = m.index + m[0].length;
        found.push({ row, rank, start: m.index, end, version: m.groups?.v });
        if (++count === MAX_PER_PATTERN) break;
      }
    });
  }
  // A statement inside a longer one ("CC BY" in "CC BY-SA 4.0") is part of it, not a second licence.
  // Sorted by start, longest first, a statement is inside an earlier one exactly when an earlier
  // one reaches its end.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  let reach = -1;
  return found.filter((f) => {
    const inside = f.end <= reach;
    reach = Math.max(reach, f.end);
    return !inside;
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
    families.set(f.row.family, [...(families.get(f.row.family) ?? []), f]);
  }
  return [...families.values()].flatMap((family) => {
    const ids = family.map((f) => ({ ...idOf(f), row: f.row }));
    const specific = ids.filter((id) => !id.generic);
    const kept = new Map((specific.length ? specific : ids).map((id) => [id.spdx, id.row]));
    return [...kept].map(([spdx, row]) => ({ spdx, row, findings: family }));
  });
}

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
  const text = edgesOf(pageText);
  const findings = findStatements(text);
  const named = namedLicences(findings);
  const reserved = findings.filter((f) => f.row.kind === "reserved");
  const vague = findings.filter((f) => f.row.kind === "vague");
  const rejected = (spdx: string, quoted: Finding[], reason: string, reason_ar: string) => ({
    spdx,
    use: "rejected" as const,
    evidence_url: url,
    quote: quoteOf(text, quoted),
    reason,
    reason_ar,
  });

  const [only, ...others] = named.toSorted((a, b) => a.spdx.localeCompare(b.spdx));
  if (only && others.length) {
    const ids = [only, ...others].map((n) => n.spdx).join(", ");
    return rejected(
      "NOASSERTION",
      only.findings,
      `conflicting licence statements: ${ids}`,
      "تذكر صفحته تراخيص متعارضة",
    );
  }
  if (only?.row.kind === "not_allowed") {
    return rejected(
      only.spdx,
      only.findings,
      `${only.spdx} is not on the allowlist`,
      `ترخيصه ${only.spdx} ليس من التراخيص المقبولة`,
    );
  }
  if (only && reserved.length) {
    return rejected(
      "NOASSERTION",
      only.findings,
      `${only.spdx} stated alongside "all rights reserved"`,
      "تذكر صفحته ترخيصًا مفتوحًا وعبارة «جميع الحقوق محفوظة» معًا",
    );
  }
  if (only) {
    return {
      spdx: only.spdx,
      use: only.row.use,
      evidence_url: url,
      quote: quoteOf(text, only.findings),
      reason: `the page states ${only.spdx}`,
      reason_ar: `تذكر صفحته ترخيص ${only.spdx}`,
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
