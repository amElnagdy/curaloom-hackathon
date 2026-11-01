// The placement level the model requests carry (#55). Replay finds each recorded reply by a hash of
// the whole request, and the scout's, the architect's and the lesson builder's briefs name the
// learner's level, so a level the recorded run never took has no recordings. In replay such a level
// is sent as the recorded one, and the intake and the plan page tell the learner. Their profile
// keeps the level their answers set. Live and record modes always send it.

import type { LearnerProfile } from "../../../contracts/index.ts";
import { RECORDED_LEVELS } from "../../../demo/script.ts";
import { config, type ProviderProfile } from "../../config.ts";

type Level = LearnerProfile["diagnostic"]["level"];

export function requestLevel(level: Level, mode: ProviderProfile = config.providerProfile): Level {
  return mode === "replay" && !RECORDED_LEVELS.includes(level) ? RECORDED_LEVELS[0] : level;
}
