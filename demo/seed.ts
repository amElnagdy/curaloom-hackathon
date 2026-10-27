// The seeded Omar session (demo/fixtures/omar.json), validated against the contracts.
// The fixture holds a {{topic}} placeholder; the topic comes from the caller (config.demoTopic).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Type, { type Static } from "typebox";
import { CONTRACTS, validate } from "../contracts/index.ts";

const Seed = Type.Object(
  {
    profile: CONTRACTS.LearnerProfile,
    consent: CONTRACTS.Consent,
    resources: Type.Array(CONTRACTS.Resource),
    plans: Type.Array(CONTRACTS.CoursePlan),
    lessons: Type.Array(CONTRACTS.Lesson),
    glossary: Type.Array(CONTRACTS.GlossaryEntry),
    quizzes: Type.Array(CONTRACTS.Quiz),
    attempts: Type.Array(CONTRACTS.QuizAttempt),
    mastery: Type.Array(CONTRACTS.Mastery),
    coach_events: Type.Array(CONTRACTS.CoachEvent),
  },
  { additionalProperties: false },
);
export type Seed = Static<typeof Seed>;

const OMAR_PATH = join(import.meta.dirname, "fixtures/omar.json");

export function loadOmarSeed(topic: string): Seed {
  const seed = validate(Seed, JSON.parse(readFileSync(OMAR_PATH, "utf8")));
  return { ...seed, profile: { ...seed.profile, topic } };
}
