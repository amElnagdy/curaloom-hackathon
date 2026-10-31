import { describe, expect, it } from "vitest";
import { loadOmarSeed } from "../demo/seed";
import { AGENT_OUTPUTS, CONTRACTS, contractErrors, validate } from "./index";

type JsonSchema = Record<string, unknown>;

// Rules Meta's strict json_schema mode needs (spike #7 notes: recursive schemas return 400).
function strictViolations(schema: JsonSchema, path = "#", depth = 0): string[] {
  const problems: string[] = [];
  if ("$ref" in schema || "$defs" in schema) problems.push(`${path}: uses $ref/$defs`);
  if (schema.type === "object") {
    const keys = Object.keys((schema.properties ?? {}) as JsonSchema);
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
    const required = (schema.required ?? []) as string[];
    if (keys.some((k) => !required.includes(k))) problems.push(`${path}: optional property`);
    if (depth > 5) problems.push(`${path}: nested deeper than 5 objects`);
    for (const key of keys) {
      const child = (schema.properties as Record<string, JsonSchema>)[key] ?? {};
      problems.push(...strictViolations(child, `${path}/${key}`, depth + 1));
    }
  }
  if (schema.type === "array") {
    problems.push(...strictViolations((schema.items ?? {}) as JsonSchema, `${path}/items`, depth));
  }
  for (const option of (schema.anyOf ?? []) as JsonSchema[]) {
    problems.push(...strictViolations(option, path, depth));
  }
  return problems;
}

describe("contracts", () => {
  it("defines every core entity", () => {
    expect(Object.keys(CONTRACTS).sort()).toEqual(
      [
        "CheckinReply",
        "CoachEvent",
        "CoachDraft",
        "ReplanNote",
        "Consent",
        "CoursePlan",
        "PlanDraft",
        "PlanChange",
        "GlossaryEntry",
        "LearnerProfile",
        "Lesson",
        "LessonDraft",
        "BuiltLesson",
        "Mastery",
        "Quiz",
        "QuizDraft",
        "KeyCheck",
        "ShortGrades",
        "QuizAttempt",
        "Resource",
        "ScoutQueries",
        "Candidates",
        "Rejection",
        "ScoutResult",
        "IntakeReply",
        "Diagnostic",
      ].sort(),
    );
  });

  it.each(Object.entries(CONTRACTS))("%s follows strict json_schema rules", (_, schema) => {
    expect(strictViolations(schema as unknown as JsonSchema)).toEqual([]);
  });

  it("names the agent-output schemas", () => {
    expect(AGENT_OUTPUTS.every((name) => name in CONTRACTS)).toBe(true);
  });
});

describe("validate", () => {
  const seed = loadOmarSeed("Spreadsheet basics");

  it("accepts the Omar seed", () => {
    expect(validate(CONTRACTS.LearnerProfile, seed.profile).name).toBe("عمر");
  });

  it("names the path of each invalid field", () => {
    const broken = { ...seed.profile, hours_per_week: "five", dialect: "martian" };

    expect(contractErrors(CONTRACTS.LearnerProfile, broken)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/hours_per_week/),
        expect.stringMatching(/^\/dialect/),
      ]),
    );
    expect(() => validate(CONTRACTS.LearnerProfile, broken)).toThrow(
      /LearnerProfile.*\/hours_per_week/,
    );
  });

  it("rejects fields the contract does not define", () => {
    expect(contractErrors(CONTRACTS.Mastery, { ...seed.mastery[0], extra: 1 })).not.toEqual([]);
  });
});

describe("Omar seed", () => {
  it("takes the topic from the caller, never from the fixture", () => {
    expect(loadOmarSeed("SQL for analysts").profile.topic).toBe("SQL for analysts");
  });

  it("gives each caller its own copy", () => {
    const first = loadOmarSeed("x");
    first.resources.splice(0);
    first.consent.granted = false;

    const second = loadOmarSeed("x");
    expect(second.resources.length).toBeGreaterThan(0);
    expect(second.consent.granted).toBe(true);
  });

  it("validates every entity against its contract", () => {
    // loadOmarSeed validates; this pins that the seed covers every contract.
    const seed = loadOmarSeed("x");
    expect(seed.resources.length).toBeGreaterThan(0);
    expect(seed.lessons.length).toBeGreaterThan(0);
    expect(seed.glossary.length).toBeGreaterThan(0);
    expect(seed.quizzes.length).toBeGreaterThan(0);
    expect(seed.attempts.length).toBeGreaterThan(0);
    expect(seed.mastery.length).toBeGreaterThan(0);
    expect(seed.coach_events.length).toBeGreaterThan(0);
    expect(seed.plans.map((p) => p.version)).toEqual([1]);
  });
});
