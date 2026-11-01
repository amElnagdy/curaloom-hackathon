import { describe, expect, it } from "vitest";
import { arabicLineProblems } from "./arabic-line.ts";

describe("an Arabic trace line", () => {
  it.each([
    "صاغ عبارتي بحث بالفرنسية",
    "قرأ قواعد الزحف لموقع fr.wikipedia.org قبل أن يفتح صفحاته",
    "تعذّرت قراءة صفحة مصدر (openwa.pressbooks.pub)",
    "طلب نموذج muse-spark-1.3 لم يجب، فاستُعمل web_search من جديد",
    "يذكر المصدر https://fr.wikipedia.org/wiki/Tableur في سطره",
    "صحّح جدول المصطلحات المعتمدة ترجمة النموذج لنصوص الرسم من «قصة قصيرة» إلى «قَصّة شعر قصيرة»",
  ])("may name a model, a tool, a URL or a host: %s", (line) => {
    expect(arabicLineProblems(line)).toEqual([]);
  });

  it.each([
    [
      "صاغ عبارات بحث بالفرنسية: tableaux croisés، Excel débutant",
      [
        "foreign word tableaux",
        "foreign word croisés",
        "foreign word Excel",
        "foreign word débutant",
      ],
    ],
    ["صاغ عبارات بحث بالروسية: сводные таблицы", ["foreign word сводные", "foreign word таблицы"]],
    ["يقرأ نصوص الرسم Visicalc.png ويترجمها", ["foreign word Visicalc.png"]],
    ["يعيد رسم pivot.svg بالنصوص العربية", ["foreign word pivot.svg"]],
    ["تحقّق من ترخيص صفحة من en.wikibooks.org: CC-BY-SA-4.0", ["foreign word CC-BY-SA-4.0"]],
    ["صحّح ترجمة «BUZZ CUT»", ["foreign word BUZZ", "foreign word CUT"]],
    ["أُرسلت إلى l_omar رسالة المدرب", ["raw id l_omar"]],
    ["نتيجة diagrams:L2:369c93968383 مطابقة", ["raw id diagrams:L2:369c93968383"]],
    ["Session reset", ["no Arabic letter", "foreign word Session", "foreign word reset"]],
  ])("names what breaks it: %s", (line, problems) => {
    expect(arabicLineProblems(line)).toEqual(problems);
  });
});
