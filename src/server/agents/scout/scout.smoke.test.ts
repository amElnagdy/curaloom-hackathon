// Proves Meta's strict json_schema mode accepts the schemas the scout's model fills in, and that what
// it returns validates. CI replays recorded responses; re-record with `pnpm fixtures:record` after
// changing a schema.

import { describe, expect, it } from "vitest";
import { contractErrors } from "../../../../contracts/index.ts";
import { loadConfig } from "../../../config.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider } from "../../providers/provider.ts";
import { Candidates, ScoutQueries } from "./scout.ts";

// RECORD_FIXTURES is a test-only switch set by `pnpm fixtures:record`, not an app setting.
const recording = process.env.RECORD_FIXTURES === "1";
if (recording) process.loadEnvFile(".env");

const provider = createProvider({
  models: loadModels(),
  profile: recording ? "record" : "replay",
  apiKey: loadConfig(process.env).modelApiKey,
});

const LEARNER = "Topic: spreadsheet basics\nThe learner's goal: محلل بيانات مبتدئ\nLevel: beginner";

const CASES = [
  {
    name: "ScoutQueries",
    schema: ScoutQueries,
    input: `Write two web search queries per language for open learning resources.\n${LEARNER}\nLanguages: en, ru, zh, fr`,
  },
  {
    name: "Candidates",
    schema: Candidates,
    input: `Describe each cited page for this learner; why_ar is in Arabic.\n${LEARNER}\n\nCited pages:\n1. https://en.wikipedia.org/wiki/Spreadsheet | Spreadsheet - Wikipedia\n2. https://en.wikibooks.org/wiki/LibreOffice_Calc | LibreOffice Calc - Wikibooks`,
  },
];

describe.each(CASES)("$name", ({ name, schema, input }) => {
  it("is accepted by Meta as a strict response format and the output validates", async () => {
    const result = await provider.structured({
      role: "agent_default",
      trace: {
        agent: "contract_smoke",
        summary_ar: `اختبار مخطط ${name}`,
        summary_en: `Smoke test for the ${name} schema`,
      },
      input,
      schema: { name, schema },
    });

    expect(contractErrors(schema, result.json)).toEqual([]);
  }, 180_000);
});
