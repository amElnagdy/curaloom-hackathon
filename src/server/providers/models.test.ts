import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { costUsd, parseModels } from "./models";

const YAML = `
roles:
  agent_default: {provider: meta, model: muse-spark-1.3, reasoning: medium}
  curriculum:    {provider: meta, model: muse-wonder-1.0}
prices:
  muse-spark-1.3: {input: 1.25, cached_input: 0.15, output: 4.25}
  muse-wonder-1.0: {input: 4.0, cached_input: 0.2, output: 20.0}
  muse-image-1.0: {per_image: 0.01}
  muse-voice-transcribe-1.0: {per_audio_hour: 0.18}
tool_prices:
  web_search: 0.0025
`;

describe("parseModels", () => {
  it("maps each role to a provider, model and params", () => {
    const models = parseModels(YAML);

    expect(models.roles.agent_default).toEqual({
      provider: "meta",
      model: "muse-spark-1.3",
      reasoning: "medium",
    });
    expect(models.roles.curriculum).toEqual({ provider: "meta", model: "muse-wonder-1.0" });
  });

  it("rejects a role whose provider is unknown", () => {
    const yaml = YAML.replace(
      "{provider: meta, model: muse-wonder-1.0}",
      "{provider: acme, model: x}",
    );

    expect(() => parseModels(yaml)).toThrow(/curriculum.*provider "acme"/);
  });

  it("rejects a role whose model has no price, so cost is never silently zero", () => {
    const yaml = YAML.replace("model: muse-wonder-1.0", "model: muse-wonder-2.0");

    expect(() => parseModels(yaml)).toThrow(/curriculum.*no price for "muse-wonder-2.0"/);
  });

  it("rejects a role key it does not apply, so config never looks applied when it is not", () => {
    const yaml = YAML.replace(
      "{provider: meta, model: muse-wonder-1.0}",
      "{provider: meta, model: muse-wonder-1.0, temperature: 0}",
    );

    expect(() => parseModels(yaml)).toThrow(/curriculum.*unknown key "temperature"/);
  });

  it("parses the checked-in config/models.yaml", () => {
    const text = readFileSync(join(import.meta.dirname, "../../../config/models.yaml"), "utf8");

    expect(Object.keys(parseModels(text).roles)).toEqual(
      expect.arrayContaining([
        "agent_default",
        "curriculum",
        "judge",
        "transcribe",
        "segment",
        "image_edit",
      ]),
    );
  });
});

describe("costUsd", () => {
  const models = parseModels(YAML);

  it("prices fresh, cached and output tokens per million plus billed searches", () => {
    const usage = { input: 1_000_000, cachedInput: 400_000, output: 100_000, searches: 2 };

    // 600k fresh * 1.25 + 400k cached * 0.15 + 100k * 4.25, per 1M, + 2 * 0.0025
    expect(costUsd(models, "muse-spark-1.3", usage)).toBeCloseTo(0.75 + 0.06 + 0.425 + 0.005, 6);
  });

  it("prices images and audio by unit", () => {
    expect(costUsd(models, "muse-image-1.0", { images: 2 })).toBeCloseTo(0.02, 6);
    expect(costUsd(models, "muse-voice-transcribe-1.0", { audioSeconds: 1800 })).toBeCloseTo(
      0.09,
      6,
    );
  });
});
