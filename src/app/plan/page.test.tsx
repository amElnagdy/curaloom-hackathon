// The plan page as the server sends it after a build stopped on a missing recording (#58): the
// failure is read from what the failed build saved, not passed in.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

// The page reads the store under DATA_DIR, which the config reads when it is first imported.
const dataDir = mkdtempSync(join(tmpdir(), "plan-page-"));
vi.stubEnv("DATA_DIR", dataDir);
const { default: PlanPage } = await import("./page.tsx");
const { TraceProvider } = await import("../_shell/trace-provider.tsx");
const { createPlanner } = await import("../../server/agents/architect/architect.ts");
const { runScout, scoutBrief } = await import("../../server/agents/scout/scout.ts");
const { createOrchestrator } = await import("../../server/orchestrator/orchestrator.ts");
const { loadModels } = await import("../../server/providers/models.ts");
const { createProvider } = await import("../../server/providers/provider.ts");
const { createFileCache, createFileStore } = await import("../../server/store/store.ts");
const { createPageFetcher } = await import("../../server/tools/fetch-page.ts");
const { createTracer } = await import("../../server/trace/trace.ts");
const { loadOmarSeed } = await import("../../../demo/seed.ts");
const { DEMO_SESSION_ID } = await import("../../../demo/session.ts");

const store = createFileStore();
const learner = { ...loadOmarSeed("x").profile, name: "سارة" };

// The route's planner, with a scout whose requests replay has no recording of.
function buildWithNoRecordings() {
  const none = join(dataDir, "no-recordings");
  const orchestrator = createOrchestrator({
    store,
    makeProvider: (onTrace) =>
      createProvider({ models: loadModels(), profile: "replay", fixturesDir: none, onTrace }),
  });
  const pages = createPageFetcher({ profile: "replay", userAgent: "test", fixturesDir: none });
  const cache = createFileCache(join(dataDir, "cache"));
  const planner = createPlanner({
    orchestrator,
    store,
    tracer: createTracer(store, DEMO_SESSION_ID),
    sessionId: DEMO_SESSION_ID,
    profile: () => learner,
    findResources: async (profile) =>
      (
        await runScout({
          orchestrator,
          sessionId: DEMO_SESSION_ID,
          brief: scoutBrief(profile),
          pages,
          cache,
        })
      ).resources,
    forgetLesson: () => {},
  });
  return planner.build().catch(() => undefined);
}

const render = async () =>
  renderToStaticMarkup(
    <TraceProvider sessionId={DEMO_SESSION_ID}>
      {await PlanPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) })}
    </TraceProvider>,
  );

describe("the plan page with no plan", () => {
  beforeEach(() => {
    store.clearDocs(DEMO_SESSION_ID);
    store.writeDoc(DEMO_SESSION_ID, "profile", learner);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("says a build that stopped on a missing recording failed, with the restart and no retry", async () => {
    await buildWithNoRecordings();

    const html = await render();

    expect(html).toContain("لم نتمكن من بناء خطتك في هذا العرض يا سارة.");
    expect(html).toContain("تعذّر البناء");
    expect(html).toContain("هذا الجزء من العرض غير مسجّل،</b> فلن تنجح إعادة المحاولة.");
    expect(html).toContain("ابدأ العرض من جديد");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).not.toMatch(/نبني خطتك|تُبنى الآن|حاول مرة أخرى|هذه المرة|aria-busy/);
  });

  it("says the plan is being built while no build has failed", async () => {
    const html = await render();

    expect(html).toContain("نبني خطتك الآن يا سارة.");
    expect(html).toContain("تُبنى الآن");
    expect(html).not.toMatch(/لم نتمكن|تعذّر البناء|ابدأ العرض من جديد/);
  });
});
