import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LessonWaiting, MissingLesson } from "./states";

const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)];

describe("the lesson pages' empty states (#65)", () => {
  it("lead a learner who has not done the interview to it, never to the example plan", () => {
    for (const html of [
      renderToStaticMarkup(<LessonWaiting progress="new" />),
      renderToStaticMarkup(<MissingLesson progress="new" />),
    ]) {
      const [[, href, label] = []] = links(html);
      expect(href).toBe("/intake");
      expect(label).toContain("ابدأ المقابلة");
      expect(html).not.toContain('href="/plan"');
    }
  });

  it("lead a learner past the interview to the plan page, and call it theirs only once it is", () => {
    const building = renderToStaticMarkup(<LessonWaiting progress="planning" />);
    const ready = renderToStaticMarkup(<MissingLesson progress="ready" />);

    expect(links(building).map(([, href, label]) => [href, label])).toEqual([
      ["/plan", expect.stringContaining("إلى صفحة الخطة")],
    ]);
    expect(links(building)[0]?.[2]).not.toContain("خطتك");
    expect(links(ready).map(([, href, label]) => [href, label])).toEqual([
      ["/plan", expect.stringContaining("اذهب إلى خطتك")],
    ]);
  });
});
