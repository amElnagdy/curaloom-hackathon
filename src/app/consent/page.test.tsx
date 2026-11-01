import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

// The page reads the store under DATA_DIR, which the config reads when it is first imported.
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "consent-page-")));
const { default: ConsentPage } = await import("./page.tsx");
const { saveGate } = await import("./consent-form.tsx");
const { createFileStore } = await import("../../server/store/store.ts");
const { sessionSim } = await import("../../server/coach/session.ts");
const { loadOmarSeed } = await import("../../../demo/seed.ts");
const { DEMO_SESSION_ID } = await import("../../../demo/session.ts");

const store = createFileStore();
const seed = loadOmarSeed("x");
const learner = { ...seed.profile, id: "l_new", name: "سارة" };

const render = async () => {
  const html = renderToStaticMarkup(await ConsentPage());
  const tag = (re: RegExp) => html.match(re)?.[1]?.replace(/<[^>]+>/g, "");
  return {
    html,
    // The pill beside the page title, and the word beside the messages switch.
    pill: tag(/<\/h1>(.*?)<\/span><\/span>/s),
    switchLabel: tag(/<span class="[^"]*value[^"]*">(.*?)<\/span>/s),
  };
};
const save = (messages: boolean) =>
  sessionSim(store, DEMO_SESSION_ID, seed).sim.setConsent({
    messages,
    quiet_hours: { start: "22:00", end: "08:00" },
    intensity: "gentle",
  });

describe("the consent page", () => {
  beforeEach(() => {
    store.clearDocs(DEMO_SESSION_ID);
    store.writeDoc(DEMO_SESSION_ID, "profile", learner);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("tells a learner who was never asked so, and never that their messages are stopped", async () => {
    const { html, pill, switchLabel } = await render();

    expect(pill).toBe("لم تُطلب موافقتك بعد");
    expect(switchLabel).toBe("غير مفعّلة");
    expect(html).not.toContain("متوقفة");
    expect(html).toContain("فعّل الرسائل أعلاه لتوافق عليها.");
  });

  it("shows the messages on once the learner agrees", async () => {
    save(true);

    const { html, pill, switchLabel } = await render();

    expect(pill).toBe("الرسائل مفعّلة");
    expect(switchLabel).toBe("مفعّلة");
    expect(html).toContain("الرسائل مفعّلة بموافقتك منذ يوم البدء");
  });

  it("shows the messages stopped only after the learner stops them", async () => {
    save(true);
    save(false);

    const { html, pill, switchLabel } = await render();

    expect(pill).toBe("الرسائل متوقفة بطلبك");
    expect(switchLabel).toBe("متوقفة");
    expect(html).toContain("الرسائل متوقفة بطلبك منذ يوم البدء");
  });

  it("marks the seed's consent as an example, in its learner's name, before the intake", async () => {
    store.deleteDoc(DEMO_SESSION_ID, "profile");

    const { html, pill } = await render();

    expect(pill).toBe("مثال");
    expect(html).toContain("هذه حدود مثال.");
    expect(html).toContain(`الرسائل مفعّلة بموافقة ${seed.profile.name} منذ يوم البدء`);
    expect(html).not.toContain("بموافقتك");
  });

  it("offers every quiet-hours end from ٦ to ١٢, ١١ ص included", async () => {
    const { html } = await render();
    const end = html.match(/id="consent-quiet-end".*?<\/select>/s)?.[0] ?? "";

    expect([...end.matchAll(/value="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "06:00",
      "07:00",
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
  });
});

// Save with the form's switch at `messages`, after `changed` moved any choice.
describe("the consent form's save", () => {
  const AGREE_FIRST = "فعّل الرسائل أعلاه لتوافق عليها.";

  it("stays closed for a learner never asked until they turn the messages on", () => {
    // Changing the quiet hours alone would save the switch off, a stop they never chose (#91).
    expect(saveGate("not_asked", { messages: false, changed: true })).toEqual({
      open: false,
      hint: AGREE_FIRST,
    });
    expect(saveGate("not_asked", { messages: false, changed: false }).hint).toBe(AGREE_FIRST);
    expect(saveGate("not_asked", { messages: true, changed: true })).toEqual({
      open: true,
      hint: null,
    });
  });

  it("opens on any change once the learner has answered", () => {
    for (const state of ["on", "stopped"] as const) {
      expect(saveGate(state, { messages: false, changed: true }).open).toBe(true);
      expect(saveGate(state, { messages: true, changed: false })).toEqual({
        open: false,
        hint: "يُفتح الحفظ حين تغيّر أحد الخيارات.",
      });
    }
  });
});
