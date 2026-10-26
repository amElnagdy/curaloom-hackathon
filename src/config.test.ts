import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("uses safe defaults when the environment is empty", () => {
    expect(loadConfig({})).toEqual({
      appName: "CuraLoom",
      demoTopic: "<DEMO_TOPIC>",
      modelApiKey: undefined,
      providerProfile: "live",
      simClock: true,
    });
  });

  it("reads every value from the environment", () => {
    const config = loadConfig({
      APP_NAME: "Other Name",
      DEMO_TOPIC: "SQL basics",
      MODEL_API_KEY: "sk-test",
      PROVIDER_PROFILE: "replay",
      SIM_CLOCK: "false",
    });

    expect(config).toEqual({
      appName: "Other Name",
      demoTopic: "SQL basics",
      modelApiKey: "sk-test",
      providerProfile: "replay",
      simClock: false,
    });
  });

  it("rejects an unknown provider profile", () => {
    expect(() => loadConfig({ PROVIDER_PROFILE: "staging" })).toThrow(/PROVIDER_PROFILE/);
  });

  it("treats blank values as unset", () => {
    expect(loadConfig({ MODEL_API_KEY: "", APP_NAME: " " })).toMatchObject({
      appName: "CuraLoom",
      modelApiKey: undefined,
    });
  });
});
