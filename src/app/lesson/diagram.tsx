// A lesson's diagram (#28): its caption, the «بالعربية»/«الأصل» toggle when it was relabelled, the
// image, the legend when it was not, and the credit for the source.

import { ExternalLink, ImageIcon, Languages } from "lucide-react";
import Image from "next/image";
import type { CSSProperties } from "react";
import type { Diagram } from "../../../contracts/index.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { forbidsChanges } from "../../server/agents/diagrams/wiki.ts";
import { BidiText } from "../_shell/ui.tsx";
import styles from "./lesson.module.css";

const PUBLIC_DOMAIN = "LicenseRef-PublicDomain";
export const SHARE_ALIKE = /-SA(-|$)/;
// A diagram is shown as wide as fills this height, up to this width, in rem.
const FIGURE_HEIGHT = 24;
const FIGURE_MAX_WIDTH = 54;

function legendTables(labels: Diagram["labels"]): Diagram["labels"][] {
  const rows = labels.filter(
    (l, i) => labels.findIndex((k) => k.src === l.src && k.ar === l.ar) === i,
  );
  const half = rows.length > 6 ? Math.ceil(rows.length / 2) : rows.length;
  return [rows.slice(0, half), rows.slice(half)].filter((t) => t.length);
}

export function DiagramFigure({ diagram, lessonId }: { diagram: Diagram; lessonId: string }) {
  const { caption_ar, source, output, licence, author, file } = diagram;
  const url = (ref: string) =>
    `/api/sessions/${encodeURIComponent(DEMO_SESSION_ID)}/diagrams/${encodeURIComponent(lessonId)}/${ref}`;
  const titleId = `${diagram.image_id}-title`;
  const fit = Math.min(FIGURE_MAX_WIDTH, (FIGURE_HEIGHT * source.width) / source.height);
  const frame = { "--ratio": `${source.width} / ${source.height}`, "--fit": `${fit}rem` };
  const shareAlike = SHARE_ALIKE.test(licence.spdx);
  return (
    <figure className={styles.figure} aria-labelledby={titleId}>
      <div className={styles.figHead}>
        <p className={styles.figTitle} id={titleId}>
          <ImageIcon aria-hidden />
          <BidiText text={caption_ar} />
        </p>
        {output && (
          <fieldset className={styles.versions}>
            <legend className="sr-only">نسخة الرسم</legend>
            <label>
              <input type="radio" name={diagram.image_id} value="arabic" defaultChecked />
              بالعربية
            </label>
            <label>
              <input type="radio" name={diagram.image_id} value="source" />
              الأصل
            </label>
          </fieldset>
        )}
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: on a phone it scrolls sideways, and the keyboard must reach it */}
      <section className={styles.well} tabIndex={0} aria-label="الرسم">
        <div className={styles.frame} style={frame as CSSProperties}>
          {output && (
            <Image
              className={styles.arabicImage}
              src={url(output.ref)}
              alt={`${caption_ar}، بتسميات عربية`}
              fill
              unoptimized
            />
          )}
          <Image
            className={styles.sourceImage}
            src={url(source.ref)}
            alt={`${caption_ar}، كما في مصدره`}
            fill
            unoptimized
          />
        </div>
      </section>
      {!output && (
        <div className={styles.legendWrap}>
          {legendTables(diagram.labels).map((rows) => (
            <table key={`${rows[0]?.src}:${rows[0]?.ar}`} className={styles.legend}>
              <thead>
                <tr>
                  <th scope="col">في الأصل</th>
                  <th scope="col">بالعربية</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={`${l.src}:${l.ar}`}>
                    <td>
                      <bdi dir="auto">{l.src}</bdi>
                    </td>
                    <td>
                      <BidiText text={l.ar} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
      <figcaption className={styles.credit}>
        <p className={styles.figNote}>
          <Languages aria-hidden />
          <span>
            {output
              ? "تُرجمت تسميات هذا الرسم إلى العربية، وبقي الباقي كما هو."
              : licence.adapt
                ? "لم تجتز النسخة العربية من هذا الرسم فحص الكود، فبقي كما في مصدره، وهذه ترجمة تسمياته."
                : forbidsChanges(licence.spdx)
                  ? "ترخيص هذا الرسم لا يسمح بتعديله، فبقي كما في مصدره، وهذه ترجمة تسمياته."
                  : "لا يُعدَّل رسم بهذا الترخيص، فبقي كما في مصدره، وهذه ترجمة تسمياته."}
            {output && shareAlike && (
              <>
                {" "}
                والنسخة العربية متاحة بالترخيص نفسه، <bdi lang="en">{licence.name}</bdi>.
              </>
            )}
          </span>
        </p>
        <p className={styles.attr}>
          {/* Meta's terms leave the labelling of what its models made to the app that shows it. */}
          {output && (
            <span data-view="arabic" title="AI-edited by Muse Image">
              نسخة عدّلها الذكاء الاصطناعي (<bdi lang="en">Muse Image</bdi>)
            </span>
          )}
          {author && (
            <span>
              صاحب الرسم <bdi dir="auto">{author}</bdi>
            </span>
          )}
          {licence.spdx === PUBLIC_DOMAIN ? (
            <span title="قرأ الكود الترخيص من صفحة الملف">ملكية عامة</span>
          ) : licence.url ? (
            <a href={licence.url} target="_blank" rel="noopener noreferrer" lang="en" dir="ltr">
              {licence.name}
              <span className="sr-only"> (يفتح في نافذة جديدة)</span>
            </a>
          ) : (
            <bdi lang="en">{licence.name}</bdi>
          )}
          <a href={file.page_url} target="_blank" rel="noopener noreferrer">
            صفحة الملف
            <ExternalLink aria-hidden />
            <span className="sr-only"> (يفتح في نافذة جديدة، ومنها قرأ الكود الترخيص)</span>
          </a>
        </p>
      </figcaption>
    </figure>
  );
}
