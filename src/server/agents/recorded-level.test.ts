import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnerProfile } from "../../../contracts/index.ts";
import { RECORDED_TOPIC } from "../../../demo/script.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import type { ProviderProfile } from "../../config.ts";

type Level = LearnerProfile["diagnostic"]["level"];

const seed = loadOmarSeed(RECORDED_TOPIC);
const at = (level: Level): LearnerProfile => ({
  ...seed.profile,
  diagnostic: { ...seed.profile.diagnostic, level },
});

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Imports the modules afresh under PROVIDER_PROFILE=`mode`, as a server in that mode reads config.
async function server(mode: ProviderProfile) {
  vi.stubEnv("PROVIDER_PROFILE", mode);
  vi.resetModules();
  const [scout, architect, lesson, orchestrator, provider, models, store, pages] =
    await Promise.all([
      import("./scout/scout.ts"),
      import("./architect/architect.ts"),
      import("./lesson/lesson.ts"),
      import("../orchestrator/orchestrator.ts"),
      import("../providers/provider.ts"),
      import("../providers/models.ts"),
      import("../store/store.ts"),
      import("../tools/fetch-page.ts"),
    ]);
  const plan = seed.plans[0];
  const lessonId = plan?.committed.lessons[0]?.id;
  if (!plan || !lessonId) throw new Error("The seed has no plan with a lesson");
  return {
    // The three briefs whose requests name the learner's level.
    briefs: (profile: LearnerProfile) => ({
      scout: scout.scoutBrief(profile),
      architect: architect.architectBrief(profile, seed.resources),
      lesson: lesson.lessonBrief(profile, plan, seed.resources, lessonId, []),
    }),
    // The scout's recorded run for `profile`, replayed with no network.
    replayScout(profile: LearnerProfile) {
      const dir = mkdtempSync(join(tmpdir(), "recorded-level-"));
      dirs.push(dir);
      return scout.runScout({
        orchestrator: orchestrator.createOrchestrator({
          store: store.createFileStore(dir),
          makeProvider: (onTrace) =>
            provider.createProvider({ models: models.loadModels(), profile: "replay", onTrace }),
        }),
        sessionId: "s1",
        brief: scout.scoutBrief(profile),
        pages: pages.createPageFetcher({
          profile: "replay",
          userAgent: "test",
          transport: async () => {
            throw new Error("replay must not touch the network");
          },
        }),
        cache: store.createFileCache(dir),
      });
    },
  };
}

describe("the level the model requests carry", () => {
  it("in replay, is the recorded level for a level with no recordings, so the requests match them", async () => {
    const { briefs } = await server("replay");

    const recorded = briefs(at("beginner"));

    expect(recorded.scout.level).toBe("beginner");
    expect(briefs(at("intermediate"))).toEqual(recorded);
    expect(briefs(at("advanced"))).toEqual(recorded);
  });

  it("in replay, plays an advanced learner's scout from the recorded run", async () => {
    const { replayScout } = await server("replay");

    const { resources } = await replayScout(at("advanced"));

    expect(resources.length).toBeGreaterThanOrEqual(5);
  });

  it("is swapped only in replay: live and record modes send the learner's own", async () => {
    const sent = async (mode: ProviderProfile) => {
      const brief = (await server(mode)).briefs(at("advanced"));
      return [brief.scout.level, brief.architect.level, brief.lesson.level];
    };

    expect(await sent("replay")).toEqual(["beginner", "beginner", "beginner"]);
    expect(await sent("live")).toEqual(["advanced", "advanced", "advanced"]);
    expect(await sent("record")).toEqual(["advanced", "advanced", "advanced"]);
  });
});
