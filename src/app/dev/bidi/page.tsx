// Mixed-direction test page (#15), not in the nav. Arabic mixed with English, Russian, Chinese and
// French, numbers, URLs, SPDX ids and punctuation at direction boundaries. Every foreign run is
// isolated with <bdi> or dir="auto"; the «بلا عزل» column shows on purpose what goes wrong without.

import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  FastForward,
  Lock,
  type LucideIcon,
  PanelLeft,
  Play,
  Send,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Lesson, Resource } from "../../../../contracts/index.ts";
import { loadOmarSeed } from "../../../../demo/seed.ts";
import { config } from "../../../config.ts";
import { Page, PageHead, Panel, SourceExcerpt } from "../../_shell/blocks.tsx";
import { latency, usd } from "../../_shell/format.ts";
import { DirIcon, LangBadge, SourceRow, StatusPill } from "../../_shell/ui.tsx";
import styles from "./bidi.module.css";

export const metadata: Metadata = { title: "اختبار اتجاه النص", robots: { index: false } };

type Excerpt = Lesson["sections"][number]["source_excerpt"];

// Each case twice: as plain text (no isolation) and with the foreign runs isolated.
const CASES: { label: string; plain: string; isolated: ReactNode }[] = [
  {
    label: "عنوان روسي ينتهي بعلامة استفهام داخل جملة عربية",
    plain: "اقرأ الفقرة الأولى من Что такое медиана? قبل الجلسة.",
    isolated: (
      <>
        اقرأ الفقرة الأولى من <bdi lang="ru">Что такое медиана?</bdi> قبل الجلسة.
      </>
    ),
  },
  {
    label: "عنوان صيني ينتهي بعلامة تعجب صينية",
    plain: "افتح أولًا 数据透视表入门！ ثم أجب عن السؤالين.",
    isolated: (
      <>
        افتح أولًا <bdi lang="zh">数据透视表入门！</bdi> ثم أجب عن السؤالين.
      </>
    ),
  },
  {
    label: "عنوان إنجليزي وحده في سطر عربي، ينتهي بنقطة",
    plain: "Pivot tables, part one.",
    isolated: <bdi lang="en">Pivot tables, part one.</bdi>,
  },
  {
    label: "قائمة رموز لاتينية تفصلها فواصل عربية",
    plain: "لغات المصادر بالترتيب: EN، RU، ZH، FR.",
    isolated: (
      <>
        لغات المصادر بالترتيب: <bdi>EN</bdi>، <bdi>RU</bdi>، <bdi>ZH</bdi>، <bdi>FR</bdi>.
      </>
    ),
  },
];

// Test excerpts in the other source languages, attached to the seed's sources in those languages.
const TEST_EXCERPTS: Excerpt[] = [
  {
    lang: "zh",
    text: "数据透视表可以同时按行和列对数据分组，并计算每一组的合计或平均值。",
    resource_id: "r3",
    locator: "§2",
  },
  {
    lang: "ru",
    text: "Медиана — это значение, которое делит упорядоченный ряд данных пополам.",
    resource_id: "r2",
    locator: "§2.1",
  },
];

const GLOSSARY: Record<"ar" | Resource["lang"], string>[] = [
  {
    ar: "جدول محوري",
    en: "pivot table",
    ru: "сводная таблица",
    zh: "数据透视表",
    fr: "tableau croisé dynamique",
  },
  { ar: "حقل", en: "field", ru: "поле", zh: "字段", fr: "champ" },
  { ar: "صف", en: "row", ru: "строка", zh: "行", fr: "ligne" },
  { ar: "متوسط", en: "mean (average)", ru: "среднее значение", zh: "平均值", fr: "moyenne" },
  { ar: "وسيط", en: "median", ru: "медиана", zh: "中位数", fr: "médiane" },
  {
    ar: "انحراف معياري",
    en: "standard deviation",
    ru: "стандартное отклонение",
    zh: "标准差",
    fr: "écart type",
  },
];
const SOURCE_LANGS = ["en", "ru", "zh", "fr"] as const;

const MIRRORED: [LucideIcon, string][] = [
  [ArrowRight, "التالي"],
  [ChevronRight, "فتات التنقل"],
  [Send, "إرسال"],
  [ExternalLink, "رابط خارجي"],
  [PanelLeft, "توسيع القائمة"],
];
const NOT_MIRRORED: [LucideIcon, string][] = [
  [Clock, "الوقت"],
  [Check, "تم"],
  [Lock, "مقفل"],
  [Play, "تشغيل"],
  [FastForward, "تقديم"],
];

function Tech({ children }: { children: string }) {
  return (
    <bdi className={styles.tech} dir="ltr" lang="en">
      {children}
    </bdi>
  );
}

function IconList({
  title,
  icons,
  mirror,
}: {
  title: string;
  icons: [LucideIcon, string][];
  mirror: boolean;
}) {
  const id = mirror ? "icons-mirrored" : "icons-kept";
  return (
    <div>
      <h3 className={styles.listTitle} id={id}>
        {title}
      </h3>
      <ul className={styles.icons} aria-labelledby={id}>
        {icons.map(([Icon, label]) => (
          <li key={label}>
            {mirror ? <DirIcon icon={Icon} /> : <Icon aria-hidden />}
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BidiPage() {
  if (!config.devTools) notFound();
  const seed = loadOmarSeed(config.demoTopic);
  const byLang = (lang: Resource["lang"]) => seed.resources.find((r) => r.lang === lang);
  const resource = (id: string) => seed.resources.find((r) => r.id === id);
  const [en, ru, zh, fr] = [byLang("en"), byLang("ru"), byLang("zh"), byLang("fr")];
  const seedExcerpt = seed.lessons[0]?.sections[0]?.source_excerpt;
  const excerpts = [...(seedExcerpt ? [seedExcerpt] : []), ...TEST_EXCERPTS];
  const sampleUrl = "https://example.org/open-course/pivot-tables?lang=en&part=1";

  return (
    <Page>
      <PageHead
        title="اختبار اتجاه النص"
        pill={<StatusPill status="neutral">صفحة للمطورين</StatusPill>}
        lede={
          <>
            نص عربي تتخلله مصطلحات وعناوين بالإنجليزية والروسية والصينية والفرنسية، وأرقام وروابط
            ومعرّفات تراخيص. كل نص أجنبي هنا معزول بالعنصر <Tech>{"<bdi>"}</Tech> أو بالسمة{" "}
            <Tech>dir="auto"</Tech>.
          </>
        }
      />

      <Panel
        id="compare-title"
        title="قبل العزل وبعده"
        sub="عمود «بلا عزل» يُظهر الخطأ عمدًا، وعمود «مع العزل» هو الصحيح."
      >
        <table className={styles.compare}>
          <thead>
            <tr>
              <th scope="col">الحالة</th>
              <th scope="col">بلا عزل</th>
              <th scope="col">مع العزل</th>
            </tr>
          </thead>
          <tbody>
            {CASES.map((c) => (
              <tr key={c.label}>
                <th scope="row">{c.label}</th>
                <td>
                  <StatusPill status="failed">خطأ ظاهر</StatusPill>
                  <p className={styles.sampleBad}>{c.plain}</p>
                </td>
                <td>
                  <StatusPill status="ready">صحيح</StatusPill>
                  <p className={styles.sample}>{c.isolated}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        id="prose-title"
        title="مصطلحات وأرقام داخل الجمل"
        sub="أرقام المتعلم بالأرقام العربية الهندية، وقيم السجل التقنية بالأرقام الغربية."
      >
        <div className={styles.prose}>
          <p>
            في هذا الدرس تتعلم الجدول المحوري، ويسمى بالإنجليزية <bdi lang="en">pivot table</bdi>،
            وبالروسية <bdi lang="ru">сводная таблица</bdi>، وبالصينية{" "}
            <bdi lang="zh">数据透视表</bdi>، وبالفرنسية{" "}
            <bdi lang="fr">tableau croisé dynamique</bdi>.
          </p>
          <p>
            مدة الجلسة ٤٥ دقيقة، وتجتاز الدرس عند ٨٠٪. كلّف استدعاء المهندس{" "}
            <Tech>{usd(0.0102)}</Tech> واستغرق <Tech>{latency(2310)}</Tech> على النموذج{" "}
            <bdi lang="en">Muse Wonder 1.0</bdi>، وبقية الوكلاء يعملون بنموذج{" "}
            <bdi lang="en">Muse Spark 1.3</bdi>.
          </p>
          <p>
            رابط المصدر:{" "}
            <a href={sampleUrl} dir="ltr" lang="en">
              {sampleUrl}
            </a>
            ، وترخيصه <bdi lang="en">CC-BY-4.0</bdi> (تحقّق منه الكود، لا النموذج).
          </p>
          <p>
            التراخيص المقبولة في هذه العينة: <bdi>CC-BY-4.0</bdi>، و<bdi>CC-BY-SA-4.0</bdi>، و
            <bdi>CC0-1.0</bdi>. أما المصدر الفرنسي فصفحته تقول «
            <bdi lang="fr">Tous droits réservés</bdi>»، فرُفض.
          </p>
          <p>
            فشل التحقق في المحاولة الأولى لأن الحقل <Tech>plan.committed.sessions[1].minutes</Tech>{" "}
            كان مفقودًا، فأُعيدت المحاولة مرة واحدة (المحاولة ٢ من ٢).
          </p>
        </div>
      </Panel>

      <Panel
        id="titles-title"
        title="عناوين المصادر بأربع لغات"
        sub="من البيانات التجريبية. العنوان الأصلي معزول، وبجانبه سبب اختياره."
      >
        <div className={styles.prose}>
          <p>
            في هذه العينة
            {en && (
              <>
                {" "}
                مصدر إنجليزي «<bdi lang="en">{en.title}</bdi>»
              </>
            )}
            {zh && (
              <>
                ، ومصدر صيني «<bdi lang="zh">{zh.title}</bdi>»
              </>
            )}
            {ru && (
              <>
                ، ومصدر روسي «<bdi lang="ru">{ru.title}</bdi>»
              </>
            )}
            .
            {fr && (
              <>
                {" "}
                أما «<bdi lang="fr">{fr.title}</bdi>» الفرنسي فرُفض، لأن الكود لم يثبت ترخيصه.
              </>
            )}
          </p>
        </div>
        <ul className={styles.sources}>
          {seed.resources.map((r) => (
            <li key={r.id}>
              <SourceRow resource={r} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        id="excerpts-title"
        title="النص الأصلي بجانب العربية"
        sub="لوحة المقتطف: لغة المصدر وموضعه وترخيصه، ثم النص باتجاهه الأصلي وعلامة المصدر."
      >
        <div className={styles.excerpts}>
          {excerpts.map((excerpt) => (
            <SourceExcerpt
              key={`${excerpt.resource_id}-${excerpt.locator}`}
              excerpt={excerpt}
              resource={resource(excerpt.resource_id)}
              sample
            />
          ))}
        </div>
      </Panel>

      <Panel
        id="glossary-title"
        title="المسرد بخمس لغات"
        sub="كل خلية أجنبية معزولة، فتبقى محاذاة الأعمدة واحدة."
      >
        {/* Five columns do not fit a phone: the table scrolls sideways in its own box. */}
        <section
          className={styles.scroll}
          aria-label="جدول المسرد"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be keyboard-scrollable
          tabIndex={0}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">العربية</th>
                {SOURCE_LANGS.map((lang) => (
                  <th key={lang} scope="col">
                    <LangBadge lang={lang} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GLOSSARY.map((row) => (
                <tr key={row.ar}>
                  <th scope="row">{row.ar}</th>
                  {SOURCE_LANGS.map((lang) => (
                    <td key={lang}>
                      <bdi lang={lang}>{row[lang]}</bdi>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </Panel>

      <Panel
        id="icons-title"
        title="اتجاه الأيقونات"
        sub="الأيقونات الاتجاهية تنعكس في الواجهة العربية، وغيرها يبقى كما هو."
      >
        <div className={styles.iconLists}>
          <IconList title="تنعكس" icons={MIRRORED} mirror />
          <IconList title="لا تنعكس" icons={NOT_MIRRORED} mirror={false} />
        </div>
      </Panel>

      <Panel
        id="inputs-title"
        title="حقول الإدخال"
        sub={
          <>
            بالسمة <Tech>dir="auto"</Tech> يتبع الحقل اتجاه ما يُكتب فيه.
          </>
        }
      >
        <div className={styles.inputs}>
          <label className={styles.field}>
            <span>عنوان مصدر بالإنجليزية</span>
            <input className={styles.input} dir="auto" defaultValue="Pivot Tables (Part 1)" />
          </label>
          <label className={styles.field}>
            <span>ملاحظة بالعربية فيها مصطلح أجنبي</span>
            <input
              className={styles.input}
              dir="auto"
              defaultValue="راجع pivot table قبل الاختبار"
            />
          </label>
        </div>
      </Panel>
    </Page>
  );
}
