// The 404 page leads to the learner's next step and calls nothing theirs that does not exist (#65).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

// The page reads the store under DATA_DIR, which the config reads when it is first imported.
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "not-found-")));
const { default: NotFound } = await import("./not-found.tsx");
const { createFileStore } = await import("../server/store/store.ts");
const { loadOmarSeed } = await import("../../demo/seed.ts");
const { DEMO_SESSION_ID } = await import("../../demo/session.ts");

const store = createFileStore();
const text = (html: string) => html.replace(/<[^>]+>/g, " ");
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(([, href, label]) => [
    href,
    text(label ?? "").trim(),
  ]);

describe("the 404 page", () => {
  beforeEach(() => {
    store.clearDocs(DEMO_SESSION_ID);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("before the interview, leads to it", async () => {
    const html = renderToStaticMarkup(await NotFound());

    expect(links(html)).toEqual([["/intake", "ابدأ المقابلة"]]);
    expect(text(html)).not.toContain("خطتك");
  });

  it("while the plan is built, or could not be, leads to the plan page without calling it theirs", async () => {
    store.writeDoc(DEMO_SESSION_ID, "profile", loadOmarSeed("x").profile);

    const html = renderToStaticMarkup(await NotFound());

    expect(links(html)).toEqual([["/plan", "إلى صفحة الخطة"]]);
    expect(text(html)).toContain("تجد حال الخطة في صفحتها.");
    expect(text(html)).not.toContain("خطتك");
  });
});
