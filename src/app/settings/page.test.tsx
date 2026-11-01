import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));

// The page reads the store under DATA_DIR, which the config reads when it is first imported.
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "settings-page-")));
const { default: SettingsPage } = await import("./page.tsx");
const { TraceProvider } = await import("../_shell/trace-provider.tsx");
const { createFileStore } = await import("../../server/store/store.ts");
const { loadOmarSeed } = await import("../../../demo/seed.ts");
const { DEMO_SESSION_ID } = await import("../../../demo/session.ts");

const store = createFileStore();
const seed = loadOmarSeed("x");

// The coach row: its pill and the sentence under its label.
const render = async () => {
  const html = renderToStaticMarkup(
    <TraceProvider sessionId={DEMO_SESSION_ID}>{await SettingsPage()}</TraceProvider>,
  );
  const row = html.match(/id="coach-consent".*?<\/a>/s)?.[0] ?? "";
  return {
    row,
    pill: row.match(/pillDot[^>]*><\/span><span>(.*?)<\/span>/s)?.[1],
  };
};

describe("Settings' coach row", () => {
  beforeEach(() => {
    store.clearDocs(DEMO_SESSION_ID);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
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
