import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Diagram } from "../../../contracts/index.ts";
import { DiagramFigure } from "./diagram.tsx";

const RELABELLED: Diagram = {
  image_id: "img_pivot",
  caption_ar: "جدول محوري يجمع الوحدات حسب المنطقة",
  resource_id: "r_ru",
  section: 0,
  file: {
    title: "Pivottable-Pivoted.PNG",
    page_url: "https://commons.wikimedia.org/wiki/File:Pivottable-Pivoted.PNG",
    image_url: "https://upload.wikimedia.org/wikipedia/commons/6/63/Pivottable-Pivoted.PNG",
  },
  author: "Wikidan829 at English Wikipedia",
  licence: { spdx: "LicenseRef-PublicDomain", name: "Public domain", url: null, adapt: true },
  labels: [{ src: "Region", ar: "المنطقة", bbox: [0, 69, 56, 13] }],
  method: "muse_image",
  source: { ref: "blob_source", mime: "image/png", width: 558, height: 137 },
  output: { ref: "blob_arabic", mime: "image/webp", width: 2928, height: 720 },
  check: { attempts: 1, problems: [] },
};
const LEGEND: Diagram = {
  ...RELABELLED,
  method: "legend",
  output: null,
  check: { attempts: 2, problems: ['the source text "Region" is still there'] },
};

const AI_EDITED = "نسخة عدّلها الذكاء الاصطناعي";
const markup = (diagram: Diagram) =>
  renderToStaticMarkup(<DiagramFigure diagram={diagram} lessonId="L2" />);
// The opening tag of the element whose text starts with `text`.
const tagOf = (html: string, text: string) => html.match(new RegExp(`<[^<>]+>${text}`))?.[0];

describe("a lesson's diagram", () => {
  // The stylesheet hides [data-view="arabic"] while «الأصل» is picked.
  it("labels a relabelled diagram's Arabic view as AI-edited, beside the source's credit", () => {
    const html = markup(RELABELLED);

    const label = tagOf(html, AI_EDITED);
    expect(label).toContain('data-view="arabic"');
    expect(label).toContain('title="AI-edited by Muse Image"');
    expect(html).toContain('صاحب الرسم <bdi dir="auto">Wikidan829 at English Wikipedia</bdi>');
    expect(html).toContain("ملكية عامة");
  });

  it("does not label a diagram shown as its source with a legend", () => {
    const html = markup(LEGEND);

    expect(html).not.toContain(AI_EDITED);
    expect(html).not.toContain("AI-edited");
    expect(html).toContain("Wikidan829 at English Wikipedia");
  });
});
