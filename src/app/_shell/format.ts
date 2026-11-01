// Text and number formats for the UI. Learner-facing numbers use Arabic-Indic digits; technical
// trace values (cost, latency, ids, times) keep Western digits.

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// A run of Latin, Cyrillic, Greek or CJK text inside Arabic. It keeps its own digits and
// punctuation, and the UI isolates it so the bidi algorithm cannot reorder its neighbours.
const FOREIGN =
  "A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF";
const INNER = `${FOREIGN}0-9 .,:;!?'"_/()&+%$@#=\\-\\[\\]\\u3000-\\u303F\\uFF01-\\uFF20`;
const FOREIGN_RUN = new RegExp(`[${FOREIGN}](?:[${INNER}]*[${FOREIGN}0-9)\\]"'])?`, "g");

// A run ends on a closing bracket only when it opened one: «المحوري (PivotTable)» leaves both
// parentheses to the Arabic text, or the isolated run would carry one and the bidi algorithm
// would mirror the other.
function unopened(run: string): string {
  const open = (run.match(/[([]/g) ?? []).length;
  const close = (run.match(/[)\]]/g) ?? []).length;
  return close > open && /[)\]]$/.test(run) ? unopened(run.slice(0, -1)) : run;
}

// `start` is the run's offset in the original text.
export type TextRun = { text: string; start: number; foreign: boolean; lang?: "ru" | "zh" };

export function splitRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(FOREIGN_RUN)) {
    if (match.index > last) {
      runs.push({ text: text.slice(last, match.index), start: last, foreign: false });
    }
    const run = unopened(match[0]);
    const lang = /[\u3400-\u9FFF]/.test(run)
      ? "zh"
      : /[\u0400-\u04FF]/.test(run)
        ? "ru"
        : undefined;
    const start = match.index;
    runs.push(
      lang ? { text: run, start, foreign: true, lang } : { text: run, start, foreign: true },
    );
    last = match.index + run.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), start: last, foreign: false });
  return runs;
}

function toArabicIndic(text: string): string {
  return text
    .replace(/(\d)\.(\d)/g, "$1٫$2")
    .replace(/(\d)%/g, "$1٪")
    .replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d);
}

// Arabic-Indic digits in the Arabic parts of a text; foreign runs ("Python 3") stay as written.
export function arabicDigits(text: string): string {
  return splitRuns(text)
    .map((run) => (run.foreign ? run.text : toArabicIndic(run.text)))
    .join("");
}

export function arabicNumber(n: number): string {
  return toArabicIndic(String(n));
}

// Arabic counted nouns: 1 and 2 have their own words, 3–10 take the plural, 11+ the singular.
export type CountForms = { one: string; two: string; few: string; many: string };

export function countOf(n: number, forms: CountForms): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const tens = n % 100;
  return `${arabicNumber(n)} ${tens >= 3 && tens <= 10 ? forms.few : forms.many}`;
}

export const HOURS: CountForms = { one: "ساعة واحدة", two: "ساعتان", few: "ساعات", many: "ساعة" };
export const MINUTES: CountForms = {
  one: "دقيقة واحدة",
  two: "دقيقتان",
  few: "دقائق",
  many: "دقيقة",
};
export const WEEKS: CountForms = {
  one: "أسبوع واحد",
  two: "أسبوعان",
  few: "أسابيع",
  many: "أسبوعًا",
};
export const MODULES: CountForms = { one: "وحدة واحدة", two: "وحدتان", few: "وحدات", many: "وحدة" };
export const LESSONS: CountForms = { one: "درس واحد", two: "درسان", few: "دروس", many: "درسًا" };
export const QUESTIONS: CountForms = {
  one: "سؤال واحد",
  two: "سؤالان",
  few: "أسئلة",
  many: "سؤالًا",
};
export const SESSIONS: CountForms = {
  one: "جلسة واحدة",
  two: "جلستان",
  few: "جلسات",
  many: "جلسة",
};
export const SOURCES: CountForms = { one: "مصدر واحد", two: "مصدران", few: "مصادر", many: "مصدرًا" };
export const ATTEMPTS: CountForms = {
  one: "محاولة واحدة",
  two: "محاولتان",
  few: "محاولات",
  many: "محاولة",
};
export const EVENTS: CountForms = { one: "حدث واحد", two: "حدثان", few: "أحداث", many: "حدثًا" };
export const MESSAGES: CountForms = {
  one: "رسالة واحدة",
  two: "رسالتان",
  few: "رسائل",
  many: "رسالة",
};
export const UPDATES: CountForms = {
  one: "تحديث واحد",
  two: "تحديثان",
  few: "تحديثات",
  many: "تحديثًا",
};
export const TERMS: CountForms = {
  one: "مصطلح واحد",
  two: "مصطلحان",
  few: "مصطلحات",
  many: "مصطلحًا",
};
export const VERSIONS: CountForms = { one: "نسخة واحدة", two: "نسختان", few: "نسخ", many: "نسخة" };
export const CHANGES: CountForms = {
  one: "تغيير واحد",
  two: "تغييران",
  few: "تغييرات",
  many: "تغييرًا",
};

export function percent(fraction: number): string {
  return `${arabicNumber(Math.round(fraction * 100))}٪`;
}

// Arabic ordinals for a 0-based position: «الدرس الأول», «الجلسة الأولى». Past the list, a digit.
const ORDINAL = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن"];
const ORDINAL_F = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة"];
export const ordinal = (index: number): string => ORDINAL[index] ?? arabicNumber(index + 1);
export const ordinalF = (index: number): string => ORDINAL_F[index] ?? arabicNumber(index + 1);

// A time of day as a learner set it ("22:00", e.g. quiet hours), in Arabic: "١٠:٠٠ م", and noon
// as "١٢:٠٠ ظهرًا". A setting, not an instant, so no clock is read. A no-break space keeps «م» with
// its number when a narrow line, such as the phone's, wraps (#57).
export function clockTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  if (h === 12 && m === 0) return "١٢:٠٠ ظهرًا";
  const minutes = String(m).padStart(2, "0");
  return `${arabicNumber(h % 12 || 12)}:${toArabicIndic(minutes)} ${h < 12 ? "ص" : "م"}`;
}

// Learner-facing time of day of a timestamp, e.g. "٨:٤٠ م". Formats a given instant; it never
// reads the current time (ADR-004).
const AR_TIME = new Intl.DateTimeFormat("ar-u-nu-arab", { hour: "numeric", minute: "2-digit" });
export function arabicTime(iso: string): string {
  return AR_TIME.format(Date.parse(iso));
}

// Technical values for the trace drawer.
const TECH_TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
export function techTime(iso: string): string {
  return TECH_TIME.format(Date.parse(iso));
}

export function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

export function latency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// The credit a reuser copies from a lesson's sources panel. scripts/notices.ts writes the same line
// for each recorded source into THIRD_PARTY_NOTICES.md.
export function creditLine(
  source: { title: string; url: string; licence: { spdx: string } },
  appName: string,
): string {
  return `«${source.title}»، ${source.url}، بترخيص ${source.licence.spdx}. الشرح العربي في ${appName} مبني على مقتطفات منه، مع تغييرات.`;
}
