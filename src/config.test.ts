import { join } from "node:path";
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
      notifierAdapter: "simulated",
      devTools: true,
      dataDir: join(process.cwd(), "data"),
    });
  });

  it("reads every value from the environment", () => {
    const config = loadConfig({
      APP_NAME: "Other Name",
      DEMO_TOPIC: "SQL basics",
      MODEL_API_KEY: "sk-test",
      PROVIDER_PROFILE: "replay",
      SIM_CLOCK: "false",
      NOTIFIER_ADAPTER: "email",
      NODE_ENV: "production",
      DATA_DIR: "/tmp/curaloom-data",
    });

    expect(config).toEqual({
      appName: "Other Name",
      demoTopic: "SQL basics",
      modelApiKey: "sk-test",
      providerProfile: "replay",
      simClock: false,
      notifierAdapter: "email",
      devTools: false,
      dataDir: "/tmp/curaloom-data",
    });
  });

  it("reads a relative DATA_DIR from the repo root, so a preview server keeps its own data", () => {
    expect(loadConfig({ DATA_DIR: ".preview-data" }).dataDir).toBe(
      join(process.cwd(), ".preview-data"),
    );
  });

  it("turns dev tools off only in a production build", () => {
    expect(loadConfig({ NODE_ENV: "production" }).devTools).toBe(false);
    expect(loadConfig({ NODE_ENV: "development" }).devTools).toBe(true);
    expect(loadConfig({ NODE_ENV: "test" }).devTools).toBe(true);
  });

  it("rejects an unknown provider profile or notifier adapter", () => {
    expect(() => loadConfig({ PROVIDER_PROFILE: "staging" })).toThrow(/PROVIDER_PROFILE/);
    expect(() => loadConfig({ NOTIFIER_ADAPTER: "sms" })).toThrow(/NOTIFIER_ADAPTER/);
  });

  it("treats blank values as unset", () => {
    expect(loadConfig({ MODEL_API_KEY: "", APP_NAME: " " })).toMatchObject({
      appName: "CuraLoom",
      modelApiKey: undefined,
    });
  });
});
