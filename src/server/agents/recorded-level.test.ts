import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnerProfile } from "../../../contracts/index.ts";
import type * as script from "../../../demo/script.ts";
import { RECORDED_LEVELS, RECORDED_TOPIC, SHORT_ANSWERS } from "../../../demo/script.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import type { ProviderProfile } from "../../config.ts";

type Level = LearnerProfile["diagnostic"]["level"];

const seed = loadOmarSeed(RECORDED_TOPIC);
const at = (level: Level): LearnerProfile => ({
  ...seed.profile,
  diagnostic: { ...seed.profile.diagnostic, level },
});

afterEach(() => vi.unstubAllEnvs());

// Imports the modules afresh under PROVIDER_PROFILE=`mode`, as a server in that mode reads config,
// with RECORDED_LEVELS as `listed` when given.
async function server(mode: ProviderProfile, listed?: Level[]) {
  vi.stubEnv("PROVIDER_PROFILE", mode);
  vi.doUnmock("../../../demo/script.ts");
  if (listed) {
    vi.doMock("../../../demo/script.ts", async (original) => ({
      ...(await original<typeof script>()),
      RECORDED_LEVELS: listed,
    }));
  }
  vi.resetModules();
  // One at a time: imports in parallel can resolve the script before its mock's factory is done.
  const recorded = await import("./recorded-level.ts");
  const scout = await import("./scout/scout.ts");
  const architect = await import("./architect/architect.ts");
  const lesson = await import("./lesson/lesson.ts");
  const plan = seed.plans[0];
  const lessonId = plan?.committed.lessons[0]?.id;
  if (!plan || !lessonId) throw new Error("The seed has no plan with a lesson");
  return {
    // The levels the three briefs whose requests name the learner's level carry.
    levels: (level: Level) => {
      const profile = at(level);
      return [
        scout.scoutBrief(profile).level,
        architect.architectBrief(profile, seed.resources).level,
        lesson.lessonBrief(profile, plan, seed.resources, lessonId, []).level,
      ];
    },
    replayShortAnswers: recorded.replayShortAnswers,
  };
}

describe("the level the model requests carry", () => {
  it("in replay, is the learner's own for each level replay has recordings of", async () => {
    const { levels } = await server("replay");

    for (const level of RECORDED_LEVELS) expect(levels(level)).toEqual([level, level, level]);
  });

  it("in replay, is the first level listed for a level not listed, so the requests match its recordings", async () => {
    const { levels } = await server("replay", ["beginner", "advanced"]);

    expect(levels("intermediate")).toEqual(["beginner", "beginner", "beginner"]);
    expect(levels("advanced")).toEqual(["advanced", "advanced", "advanced"]);
  });

  it("is the learner's own in live and record modes, listed or not", async () => {
    for (const mode of ["live", "record"] as const) {
      const { levels } = await server(mode, ["beginner"]);
      expect(levels("advanced")).toEqual(["advanced", "advanced", "advanced"]);
    }
  });
});

describe("the short answers replay grades and offers", () => {
  // A quiz of two short items between multiple-choice ones, as a level's run wrote it.
  const quiz = {
    items: (["mcq", "short", "mcq", "short"] as const).map((type, i) => ({
      id: `q${i + 1}`,
      type,
      prompt_ar: "سؤال",
      options_ar: type === "mcq" ? ["أ", "ب"] : [],
      answer: type === "mcq" ? "أ" : `الإجابة النموذجية ${i + 1}`,
      rubric_ar: "معيار",
      glossary_ids: [],
    })),
  };

  it("are Omar's words on the beginner's run and the model answers on the other levels', for the quizzes they graded", async () => {
    const { replayShortAnswers } = await server("replay");

    expect(replayShortAnswers("L1", 0, { level: "beginner", quiz })).toEqual(SHORT_ANSWERS.L1[0]);
    expect(replayShortAnswers("L1", 1, { level: "beginner", quiz })).toEqual(SHORT_ANSWERS.L1[1]);
    for (const level of ["intermediate", "advanced"] as const) {
      for (const n of [0, 1]) {
        expect(replayShortAnswers("L1", n, { level, quiz })).toEqual([
          "الإجابة النموذجية 2",
          "الإجابة النموذجية 4",
        ]);
      }
      expect(replayShortAnswers("L1", 2, { level, quiz })).toBeUndefined();
      expect(replayShortAnswers("L2", 0, { level, quiz })).toBeUndefined();
    }
    expect(replayShortAnswers("L1", 1)).toBeDefined();
    expect(replayShortAnswers("L1", 2)).toBeUndefined();
  });

  it("are Omar's words for a level not listed, which plays the beginner's run", async () => {
    const { replayShortAnswers } = await server("replay", ["beginner"]);

    expect(replayShortAnswers("L1", 0, { level: "advanced", quiz })).toEqual(SHORT_ANSWERS.L1[0]);
  });

  it("are none in live or record mode", async () => {
    for (const mode of ["live", "record"] as const) {
      const { replayShortAnswers } = await server(mode);
      expect(replayShortAnswers("L1", 0, { level: "advanced", quiz })).toBeUndefined();
      expect(replayShortAnswers("L1", 0)).toBeUndefined();
    }
  });
});
