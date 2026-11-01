import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

// The page reads the store under DATA_DIR, which the config reads when it is first imported.
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "coach-page-")));
const { default: CoachPage } = await import("./page.tsx");
const { TraceProvider } = await import("../_shell/trace-provider.tsx");
const { contentHash, createFileStore } = await import("../../server/store/store.ts");
const { sessionSim } = await import("../../server/coach/session.ts");
const { loadOmarSeed } = await import("../../../demo/seed.ts");
const { DEMO_SESSION_ID } = await import("../../../demo/session.ts");

const store = createFileStore();
const seed = loadOmarSeed("x");
const learner = { ...seed.profile, id: "l_new", name: "سارة" };
const ADVANCE = "قدّم الوقت بأداة العرض";

const render = async () => {
  const html = renderToStaticMarkup(
    <TraceProvider sessionId={DEMO_SESSION_ID}>{await CoachPage()}</TraceProvider>,
  );
  return {
    html,
    // The status pill beside the page title, after the channel tag.
    pill: html.match(/<\/h1>.*?pillDot[^>]*><\/span><span>(.*?)<\/span>/s)?.[1],
  };
};
const sim = () => sessionSim(store, DEMO_SESSION_ID, seed).sim;
const save = (messages: boolean) =>
  sim().setConsent({
    messages,
    quiet_hours: { start: "22:00", end: "08:00" },
    intensity: "gentle",
  });

describe("the coach page", () => {
  beforeEach(() => {
    store.clearDocs(DEMO_SESSION_ID);
  });
  // After the intake, with the learner's own plan built.
  const planned = () => {
    store.writeDoc(DEMO_SESSION_ID, "profile", learner);
    store.writeDoc(DEMO_SESSION_ID, "plan", {
      for_profile: contentHash(learner),
      versions: seed.plans,
      resources: seed.resources,
      limits: { budget_minutes: 300, resource_ids: [] },
      pending: null,
    });
  };
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("marks the seed's Omar as an example before the intake", async () => {
    const { pill } = await render();

    expect(pill).toBe("مثال");
  });

  it("asks the learner to move the clock only while their messages are on", async () => {
    planned();

    const notAsked = await render();
    save(true);
    const on = await render();
    save(false);
    const stopped = await render();

    expect(notAsked.pill).toBe("لم تُطلب موافقتك بعد");
    expect(notAsked.html).not.toContain(ADVANCE);
    expect(notAsked.html).toContain("الساعة الآن يوم البدء");
    expect(on.html).toContain(ADVANCE);
    expect(stopped.html).not.toContain(ADVANCE);
  });

  it("keeps a message held back before a «توقف» on the same day as not agreed", async () => {
    planned();
    // Never agreed: the day-2 message is held at 09:00, then the learner stops at that minute.
    await sim().set(2);
    sim().reply("توقف");
    const day2 = await render();
    await sim().set(5);
    const day5 = await render();

    expect(day2.html).toContain("لم تُرسل قبل موافقتك");
    expect(day2.html).not.toContain("أُوقفت بطلبك");
    expect(day2.html).toContain(`لم تُرسل رسالة، فلم يكن ${learner.name} قد وافق على الرسائل.`);
    // The day-5 message came after the stop.
    expect(day5.html).toContain("أُوقفت بطلبك");
    expect(day5.html).toContain("لم تُرسل رسالة، لأن الرسائل متوقفة.");
  });
});
