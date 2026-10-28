// The seeded Omar session (demo/fixtures/omar.json), validated against the contracts.
// The fixture holds a {{topic}} placeholder; the topic comes from the caller (config.demoTopic).

import Type, { type Static } from "typebox";
import { CONTRACTS, validate } from "../contracts/index.ts";
// A static import, so the fixture is bundled into the Next.js server.
import omar from "./fixtures/omar.json" with { type: "json" };

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

// Each call gets its own copy, so no caller can change the seed another request reads.
export function loadOmarSeed(topic: string): Seed {
  const seed = validate(Seed, structuredClone(omar));
  return { ...seed, profile: { ...seed.profile, topic } };
}
