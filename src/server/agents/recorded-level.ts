// The placement level the model requests carry (#55, #98). Replay finds each recorded reply by a hash
// of the whole request, and the scout's, the architect's and the lesson builder's briefs name the
// learner's level, so replay plays a level only on that level's own recordings. A level not in
// RECORDED_LEVELS has none: in replay it is sent as the first one listed, and the intake and the plan
// page tell the learner. Their profile keeps the level their answers set. Live and record modes
// always send it.

import type { LearnerProfile, Quiz } from "../../../contracts/index.ts";
import { RECORDED_LEVELS, recordedShortAnswers } from "../../../demo/script.ts";
import { config, type ProviderProfile } from "../../config.ts";

type Level = LearnerProfile["diagnostic"]["level"];

export function requestLevel(level: Level, mode: ProviderProfile = config.providerProfile): Level {
  return mode === "replay" && !RECORDED_LEVELS.includes(level) ? RECORDED_LEVELS[0] : level;
}

// In replay, the short answers the recorded run gave to the `n`th quiz of a lesson (0 for its first),
// if it graded that quiz: the examiner grades them in place of other text, and the quiz page offers
// them as chips. `at` names the learner's level and the quiz, whose answers differ by the level the
// requests carry; without it, the beginner's run says whether that quiz was graded, as every recorded
// level's run graded the same ones.
export function replayShortAnswers(
  lessonId: string,
  n: number,
  at?: { level: Level; quiz: Pick<Quiz, "items"> },
  mode: ProviderProfile = config.providerProfile,
): readonly string[] | undefined {
  if (mode !== "replay") return undefined;
  return recordedShortAnswers(lessonId, n, at && { ...at, level: requestLevel(at.level, mode) });
}
