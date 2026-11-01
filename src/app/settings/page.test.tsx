import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));

// The page reads the store under DATA_DIR, which the config reads when it is first imported.
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "settings-page-")));
afterAll(() => {
  vi.unstubAllEnvs();
});
const { default: SettingsPage } = await import("./page.tsx");
const { TraceProvider } = await import("../_shell/trace-provider.tsx");
const { createFileStore } = await import("../../server/store/store.ts");
const { loadOmarSeed } = await import("../../../demo/seed.ts");
const { DEMO_SESSION_ID } = await import("../../../demo/session.ts");
const { ladderMarks } = await import("../../server/coach/ladder.ts");
const { simDay } = await import("../_shell/course.ts");

const store = createFileStore();
const seed = loadOmarSeed("x");

// The coach row: its pill and the sentence under its label.
const render = async () => {
  const html = renderToStaticMarkup(
    <TraceProvider sessionId={DEMO_SESSION_ID}>{await SettingsPage()}</TraceProvider>,
  );
  const row = html.match(/id="coach-consent".*?<\/a>/s)?.[0] ?? "";
  return {
    html,
    row,
    pill: row.match(/pillDot[^>]*><\/span><span>(.*?)<\/span>/s)?.[1],
  };
};

// The page as a server started with `env` renders it: the config is read again on import.
const renderWith = async (env: Record<string, string>) => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const page = await import("./page.tsx");
  const trace = await import("../_shell/trace-provider.tsx");
  return renderToStaticMarkup(
    <trace.TraceProvider sessionId={DEMO_SESSION_ID}>{await page.default()}</trace.TraceProvider>,
  );
};

// The text of each row's label, help and value, tags dropped.
const rowText = (html: string, labelId: string) =>
  (html.match(new RegExp(`id="${labelId}".*?</div></div>`, "s"))?.[0] ?? "").replace(
    /<[^>]+>/g,
    " ",
  );

describe("Settings' coach row", () => {
  beforeEach(() => {
    store.clearDocs(DEMO_SESSION_ID);
  });

  it("names whose consent it is: the sample learner's before the intake, yours after", async () => {
    const sample = await render();
    store.writeDoc(DEMO_SESSION_ID, "profile", { ...seed.profile, id: "l_new", name: "سارة" });
    const own = await render();

    expect(sample.pill).toBe("مثال");
    expect(sample.row).toContain(`الرسائل مفعّلة بموافقة ${seed.profile.name} منذ يوم البدء`);
    expect(own.pill).toBe("لم تُطلب موافقتك بعد");
    expect(own.row).toContain("لا تصلك أي رسالة من المدرب قبل أن توافق عليها.");
  });
});

describe("Settings' clock", () => {
  it("jumps to the days the demo bar marks", async () => {
    const { html } = await render();
    const jump = html.match(/aria-labelledby="clock-jump".*?<\/fieldset>/s)?.[0] ?? "";

    expect([...jump.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1])).toEqual(
      ladderMarks().map((m) => simDay(m.day)),
    );
  });
});

describe("Settings' models and app panels", () => {
  it("name the model mode in Arabic only, with the setting names folded under it", async () => {
    const html = await renderWith({ PROVIDER_PROFILE: "replay" });
    const segments = html.match(/aria-labelledby="profile-label".*?<\/ul>/s)?.[0] ?? "";
    const fold = html.match(/<details.*?<\/details>/s)?.[0] ?? "";

    expect([...segments.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1])).toEqual([
      "مباشر",
      "يسجّل الآن",
      "ردود مسجّلة",
    ]);
    expect(fold).toContain("<summary>تفاصيل تقنية</summary>");
    expect(fold).toContain("PROVIDER_PROFILE=replay");
    expect(fold).toContain("config/models.yaml");
    expect(html.replace(fold, "")).not.toMatch(/PROVIDER_PROFILE|models\.yaml|\.env/);
  });

  it("show the app's name and the server's topic, with no placeholder note", async () => {
    const html = await renderWith({ DEMO_TOPIC: "Excel pivot tables for data analysis" });

    expect(html).not.toContain("اسم مؤقت");
    expect(html).not.toContain("لم يُحدَّد");
    expect(rowText(html, "app-name")).toContain("CuraLoom");
    expect(html).toMatch(/<bdi[^>]*lang="en"[^>]*>Excel pivot tables for data analysis<\/bdi>/);
  });

  it("say that no topic is set only when the server has none", async () => {
    const html = await renderWith({ DEMO_TOPIC: "" });

    expect(rowText(html, "app-topic")).toContain("لم يُحدَّد");
    expect(rowText(html, "app-topic")).not.toContain("DEMO_TOPIC");
  });
});
