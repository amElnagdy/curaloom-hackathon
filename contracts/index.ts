// Contracts for the core entities (#14). Each schema is plain JSON Schema (TypeBox) that also works
// as a Meta `json_schema` response format: flat (no $ref), every property required, no extra
// properties. An optional value is nullable instead of omitted.

import Type, { type Static, type TSchema } from "typebox";
import Value from "typebox/value";

const Obj = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
const StringEnum = <const T extends readonly string[]>(values: T) =>
  Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const SOURCE_LANGS = ["en", "ru", "zh", "fr"] as const;
const SourceLang = StringEnum(SOURCE_LANGS);
const Score = Type.Number({ description: "0 to 1" });

export const LearnerProfile = Obj({
  id: Type.String(),
  name: Type.String(),
  locale: StringEnum(["ar"]),
  dialect: StringEnum(["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"]),
  goal: Type.String(),
  topic: Type.String(),
  hours_per_week: Type.Number(),
  background: Type.Array(Type.String()),
  source_langs_ok: Type.Array(SourceLang),
  diagnostic: Obj({
    level: StringEnum(["beginner", "intermediate", "advanced"]),
    scores: Type.Array(Obj({ question_id: Type.String(), score: Score })),
  }),
  history_notes: Type.String(),
});

export const Consent = Obj({
  learner_id: Type.String(),
  channel: StringEnum(["simulated"]),
  granted: Type.Boolean(),
  granted_sim_day: Nullable(Type.Integer()),
  quiet_hours: Nullable(
    Obj({
      start: Type.String({ description: "HH:MM, learner's local time" }),
      end: Type.String({ description: "HH:MM, learner's local time" }),
    }),
  ),
  opted_out: Type.Boolean(),
  opted_out_sim_day: Nullable(Type.Integer()),
});

export const Resource = Obj({
  id: Type.String(),
  url: Type.String(),
  title: Type.String(),
  lang: SourceLang,
  licence: Obj({
    spdx: Type.String({ description: "SPDX id, e.g. CC-BY-4.0" }),
    evidence_url: Type.String(),
    verified: Type.Boolean({
      description:
        "true only after code fetched evidence_url and confirmed the licence; a model sets false",
    }),
  }),
  type: StringEnum(["article", "video", "book", "course"]),
  citations: Type.Array(Obj({ url: Type.String() })),
  score: Score,
  why_ar: Type.String(),
});

// Versioned: a re-plan is a new CoursePlan with version n+1, never an edit of the old one.
export const CoursePlan = Obj({
  id: Type.String(),
  road: Type.Array(Obj({ module: Type.String(), weeks: Type.Number() })),
  committed: Obj({
    start: Type.String({ description: "simulated day, e.g. day0" }),
    weeks: Type.Integer(),
    sessions: Type.Array(
      Obj({
        id: Type.String(),
        day: Type.Integer(),
        minutes: Type.Integer(),
        lesson_id: Type.String(),
        resource_ids: Type.Array(Type.String()),
      }),
    ),
  }),
  version: Type.Integer(),
  reason: Type.String(),
});

export const Lesson = Obj({
  id: Type.String(),
  title_ar: Type.String(),
  objectives_ar: Type.Array(Type.String()),
  sections: Type.Array(
    Obj({
      source_excerpt: Obj({
        lang: SourceLang,
        text: Type.String(),
        resource_id: Type.String(),
        locator: Type.String({ description: "where in the resource, e.g. §2 or 03:15" }),
      }),
      arabic: Type.String(),
      notes_ar: Type.String(),
    }),
  ),
  glossary_ids: Type.Array(Type.String()),
});

export const GlossaryEntry = Obj({
  id: Type.String(),
  ar: Type.String(),
  ar_diacritized: Type.String({ description: "the Arabic term with full tashkeel" }),
  src: Obj({ lang: SourceLang, term: Type.String() }),
  definition_ar: Type.String(),
  example_ar: Type.String(),
});

export const Quiz = Obj({
  id: Type.String(),
  lesson_id: Type.String(),
  items: Type.Array(
    Obj({
      id: Type.String(),
      type: StringEnum(["mcq", "short"]),
      prompt_ar: Type.String(),
      options_ar: Type.Array(Type.String(), { description: "empty for short answers" }),
      answer: Type.String({ description: "for mcq, exactly one of options_ar" }),
      rubric_ar: Type.String(),
      glossary_ids: Type.Array(Type.String()),
    }),
  ),
  pass_threshold: Score,
});

export const QuizAttempt = Obj({
  id: Type.String(),
  quiz_id: Type.String(),
  lesson_id: Type.String(),
  sim_day: Type.Integer(),
  answers: Type.Array(
    Obj({
      item_id: Type.String(),
      response: Type.String(),
      score: Score,
      feedback_ar: Type.String(),
    }),
  ),
  score: Score,
  passed: Type.Boolean(),
});

export const Mastery = Obj({
  lesson_id: Type.String(),
  best_score: Score,
  passed: Type.Boolean(),
  attempts: Type.Integer(),
});

export const CoachEvent = Obj({
  id: Type.String(),
  sim_day: Type.Integer(),
  type: StringEnum(["nudge", "replan", "checkin", "weekly", "comeback"]),
  channel: StringEnum(["simulated"]),
  message_ar: Type.String(),
  status: StringEnum(["queued", "sent", "suppressed_quiet_hours", "suppressed_opt_out"]),
});

export const CONTRACTS = {
  LearnerProfile,
  Consent,
  Resource,
  CoursePlan,
  Lesson,
  GlossaryEntry,
  Quiz,
  QuizAttempt,
  Mastery,
  CoachEvent,
};
export type ContractName = keyof typeof CONTRACTS;

// Schemas a model fills in through `provider.structured`; each has a recorded smoke test.
export const AGENT_OUTPUTS = [
  "LearnerProfile",
  "Resource",
  "CoursePlan",
  "Lesson",
  "GlossaryEntry",
  "Quiz",
  "QuizAttempt",
  "CoachEvent",
] as const satisfies readonly ContractName[];

export type LearnerProfile = Static<typeof LearnerProfile>;
export type Consent = Static<typeof Consent>;
export type Resource = Static<typeof Resource>;
export type CoursePlan = Static<typeof CoursePlan>;
export type Lesson = Static<typeof Lesson>;
export type GlossaryEntry = Static<typeof GlossaryEntry>;
export type Quiz = Static<typeof Quiz>;
export type QuizAttempt = Static<typeof QuizAttempt>;
export type Mastery = Static<typeof Mastery>;
export type CoachEvent = Static<typeof CoachEvent>;

function nameOf(schema: TSchema): string {
  return Object.entries(CONTRACTS).find(([, s]) => s === schema)?.[0] ?? "value";
}

// One line per problem: "<json pointer> <message>".
export function contractErrors(schema: TSchema, value: unknown): string[] {
  return [...Value.Errors(schema, value)].map((e) => `${e.instancePath || "/"} ${e.message}`);
}

export function validate<S extends TSchema>(schema: S, value: unknown): Static<S> {
  const errors = contractErrors(schema, value);
  if (errors.length) throw new Error(`${nameOf(schema)} is invalid: ${errors.join("; ")}`);
  return value as Static<S>;
}
