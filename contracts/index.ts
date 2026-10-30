// Contracts for the core entities (#14). Each schema is plain JSON Schema (TypeBox) that also works
// as a Meta `json_schema` response format: flat (no $ref), every property required, no extra
// properties. An optional value is nullable instead of omitted.

import Type, { type Static, type TSchema } from "typebox";
import Value from "typebox/value";

const Obj = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
const StringEnum = <const T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
) => Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const SOURCE_LANGS = ["en", "ru", "zh", "fr"] as const;
const SourceLang = StringEnum(SOURCE_LANGS);
const DIALECTS = ["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"] as const;
const Score = Type.Number({ description: "0 to 1" });

export const LearnerProfile = Obj({
  id: Type.String(),
  name: Type.String(),
  locale: StringEnum(["ar"]),
  dialect: StringEnum(DIALECTS),
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

// The intake (#16). The model fills IntakeReply on each learner message and Diagnostic once per
// topic; code builds the LearnerProfile from them. A field the learner has not given yet is null.
export const IntakeReply = Obj({
  heard: Obj({
    goal: Nullable(
      Type.String({
        description: "the role or outcome the learner wants, as a short Arabic phrase",
      }),
    ),
    background: Nullable(
      Type.Array(Type.String(), {
        description: "the learner's job and skills as short lowercase English tags, e.g. excel",
      }),
    ),
    hours_per_week: Nullable(Type.Number({ description: "hours a week the learner can study" })),
    source_langs_ok: Nullable(
      Type.Array(SourceLang, { description: "the languages the learner accepts sources in" }),
    ),
    history_notes: Nullable(
      Type.String({
        description:
          "a short Arabic note on courses the learner dropped and why, and anything the coach should respect",
      }),
    ),
  }),
  dialect: StringEnum(DIALECTS, { description: "the dialect the learner writes in" }),
  ack_ar: Type.String({ description: "a few words acknowledging the learner's latest message" }),
  ask_ar: Type.String({
    description: "your questions about what is still missing; empty when nothing is missing",
  }),
});

export const Diagnostic = Obj({
  questions: Type.Array(
    Obj({
      prompt_ar: Type.String(),
      options_ar: Type.Array(Type.String(), { description: "four short options" }),
      answer: Type.String({ description: "exactly one of options_ar, copied exactly" }),
    }),
  ),
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

const ResourceType = StringEnum(["article", "video", "book", "course"]);

export const Resource = Obj({
  id: Type.String(),
  url: Type.String(),
  title: Type.String(),
  lang: SourceLang,
  licence: Obj({
    spdx: Type.String({ description: "SPDX id, e.g. CC-BY-4.0" }),
    use: StringEnum(["open", "personal_study"], {
      description: "personal_study: an NC or ND licence, for the learner's own study only",
    }),
    evidence_url: Type.String(),
    quote: Type.String({ description: "the licence statement as quoted from evidence_url" }),
    verified: Type.Boolean({
      description: "true only after code fetched evidence_url and classified its licence",
    }),
  }),
  type: ResourceType,
  citations: Type.Array(Obj({ url: Type.String() })),
  score: Score,
  why_ar: Type.String(),
});

// The scout (#17). The model fills ScoutQueries and Candidates; code builds ScoutResult from them.
export const ScoutQueries = Obj({
  queries: Type.Array(
    Obj({
      lang: SourceLang,
      queries: Type.Array(Type.String(), {
        description: "two short web search queries, written in that language",
      }),
    }),
  ),
});

// What the model says about a page it cited. Licence fields are absent on purpose: code decides.
export const Candidates = Obj({
  candidates: Type.Array(
    Obj({
      url: Type.String({ description: "one of the cited page URLs, copied exactly" }),
      title: Type.String(),
      lang: SourceLang,
      type: ResourceType,
      why_ar: Type.String({
        description: "one Arabic sentence on why this page suits the learner",
      }),
      relevance: Type.Number({ description: "how closely the page teaches the topic, 0 to 1" }),
      level_fit: Type.Number({
        description: "how well the page suits the learner's level, 0 to 1",
      }),
    }),
  ),
});

// A cited page the scout did not keep, with the reason in English and in Arabic.
export const Rejection = Obj({
  url: Type.String(),
  title: Type.String(),
  lang: SourceLang,
  reason: Type.String(),
  reason_ar: Type.String(),
});

export const ScoutResult = Obj({
  resources: Type.Array(Resource, { minItems: 1, maxItems: 8 }),
  rejected: Type.Array(Rejection),
});

// The architect (#18). The model fills PlanDraft; code builds the CoursePlan from it. A lesson sits
// in its module and a session in its lesson, so the only reference the model writes is a resource
// id.
export const PlanDraft = Obj({
  road: Type.Array(
    Obj({
      title_ar: Type.String({ description: "the module's name in Arabic, a few words" }),
      weeks: Type.Integer({ description: "whole weeks the module takes, at least 1" }),
      lessons: Type.Array(
        Obj({
          title_ar: Type.String({ description: "what the lesson teaches, in Arabic, a few words" }),
          resource_ids: Type.Array(Type.String(), {
            description: "ids of the resources the lesson draws on, copied exactly",
          }),
          sessions: Type.Array(
            Obj({
              day: Type.Integer({ description: "day of the course, from 0" }),
              minutes: Type.Integer(),
            }),
          ),
        }),
        {
          description: "only lessons in the first two weeks; empty for a module that starts later",
        },
      ),
    }),
  ),
  rationale_ar: Type.String({
    description: "why this plan suits the learner, two to four Arabic sentences addressed to them",
  }),
});

// Versioned: a re-plan or a learner's edit is a new CoursePlan with version n+1, never an edit of
// the old one.
export const CoursePlan = Obj({
  id: Type.String(),
  road: Type.Array(Obj({ module: Type.String(), weeks: Type.Number() })),
  committed: Obj({
    start: Type.String({ description: "simulated day, e.g. day0" }),
    weeks: Type.Integer(),
    lessons: Type.Array(
      Obj({
        id: Type.String(),
        title_ar: Type.String(),
        module: Type.Integer({ description: "the index of the lesson's module in road" }),
      }),
    ),
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
  rationale_ar: Type.String({ description: "why this plan suits the learner, shown to them" }),
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

// The lesson builder (#19). The model fills LessonDraft, naming each excerpt by a range of its
// resource's numbered sentences; code cuts the excerpts and builds the Lesson and its GlossaryEntry
// list, the BuiltLesson.
export const LessonDraft = Obj({
  objectives_ar: Type.Array(Type.String(), {
    description: "two to four things the learner can do after the lesson, in Arabic",
  }),
  sections: Type.Array(
    Obj({
      resource_id: Type.String({
        description: "id of the resource the excerpt is from, copied exactly",
      }),
      first_sentence: Type.Integer({
        description: "the number of the excerpt's first sentence in that resource's numbered text",
      }),
      last_sentence: Type.Integer({ description: "the number of its last sentence" }),
      locator: Type.String({
        description:
          "the heading in the resource the excerpt sits under, as the resource writes it",
      }),
      arabic: Type.String({ description: "the explanation of the excerpt, in Arabic" }),
      notes_ar: Type.String({ description: "one practical tip or example, in Arabic" }),
    }),
  ),
  glossary: Type.Array(
    Obj({
      lang: SourceLang,
      term: Type.String({ description: "the term as the source writes it" }),
      ar: Type.String({ description: "the standard Arabic term, without tashkeel" }),
      ar_diacritized: Type.String({ description: "the Arabic term with full tashkeel" }),
      definition_ar: Type.String(),
      example_ar: Type.String(),
    }),
  ),
});

export const BuiltLesson = Obj({ lesson: Lesson, glossary: Type.Array(GlossaryEntry) });

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

// What the examiner's model writes (#20). Code numbers the items, sets the gate and checks the
// rules, so a draft carries no ids.
export const QuizDraft = Obj({
  items: Type.Array(
    Obj({
      type: StringEnum(["mcq", "short"]),
      prompt_ar: Type.String({ description: "the question, in Arabic" }),
      options_ar: Type.Array(Type.String(), {
        description: "for mcq, 4 options in Arabic; empty for a short answer",
      }),
      answer: Type.String({
        description: "for mcq, the right option copied exactly; for a short answer, a model answer",
      }),
      rubric_ar: Type.String({
        description:
          "for mcq, one sentence on why the answer is right; for a short answer, what earns full and half credit; in Arabic",
      }),
      glossary_ids: Type.Array(Type.String(), {
        description: "ids of the lesson's glossary terms the item checks, copied exactly",
      }),
    }),
  ),
});

// The judge's answers to a quiz's multiple-choice items, from the lesson alone, without the keys.
export const KeyCheck = Obj({
  choices: Type.Array(
    Obj({
      item_id: Type.String({ description: "the item's id, copied exactly" }),
      choice: Type.String({ description: "the option the lesson supports, copied exactly" }),
    }),
  ),
});

// The judge's grades for an attempt's short answers.
export const ShortGrades = Obj({
  grades: Type.Array(
    Obj({
      item_id: Type.String({ description: "the item's id, copied exactly" }),
      score: Type.Number({
        description: "1 for full credit, 0.5 for half, 0 for none, by the rubric",
      }),
      feedback_ar: Type.String({
        description:
          "one or two sentences to the learner, in Arabic: what the answer got right and what it missed",
      }),
    }),
  ),
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
  IntakeReply,
  Diagnostic,
  Consent,
  Resource,
  ScoutQueries,
  Candidates,
  Rejection,
  ScoutResult,
  PlanDraft,
  CoursePlan,
  Lesson,
  GlossaryEntry,
  LessonDraft,
  BuiltLesson,
  QuizDraft,
  KeyCheck,
  ShortGrades,
  Quiz,
  QuizAttempt,
  Mastery,
  CoachEvent,
};
export type ContractName = keyof typeof CONTRACTS;

// Schemas a model fills in through `provider.structured`; each has a recorded smoke test.
// Resource and ScoutResult are not: the scout builds them in code from model-filled Candidates.
// Nor is CoursePlan: the architect builds it from a PlanDraft. Nor are Lesson and GlossaryEntry:
// the lesson builder builds them from a LessonDraft. Nor are Quiz and QuizAttempt: the examiner
// builds them from a QuizDraft, a KeyCheck and ShortGrades.
export const AGENT_OUTPUTS = [
  "LearnerProfile",
  "IntakeReply",
  "Diagnostic",
  "ScoutQueries",
  "Candidates",
  "PlanDraft",
  "LessonDraft",
  "QuizDraft",
  "KeyCheck",
  "ShortGrades",
  "CoachEvent",
] as const satisfies readonly ContractName[];

export type LearnerProfile = Static<typeof LearnerProfile>;
export type IntakeReply = Static<typeof IntakeReply>;
export type Diagnostic = Static<typeof Diagnostic>;
export type Consent = Static<typeof Consent>;
export type Resource = Static<typeof Resource>;
export type ScoutQueries = Static<typeof ScoutQueries>;
export type Candidates = Static<typeof Candidates>;
export type Rejection = Static<typeof Rejection>;
export type ScoutResult = Static<typeof ScoutResult>;
export type PlanDraft = Static<typeof PlanDraft>;
export type CoursePlan = Static<typeof CoursePlan>;
export type Lesson = Static<typeof Lesson>;
export type GlossaryEntry = Static<typeof GlossaryEntry>;
export type LessonDraft = Static<typeof LessonDraft>;
export type BuiltLesson = Static<typeof BuiltLesson>;
export type QuizDraft = Static<typeof QuizDraft>;
export type KeyCheck = Static<typeof KeyCheck>;
export type ShortGrades = Static<typeof ShortGrades>;
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
