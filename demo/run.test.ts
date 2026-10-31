import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { configEnv, loadConfig } from "../src/config.ts";
import { DEMO_PACE, demoServer } from "./run.ts";
import { RECORDED_TOPIC } from "./script.ts";

const KEY = { MODEL_API_KEY: "sk-test-secret" };

// What the started server's config reads: its own settings over the launcher's environment.
const served = (mode: Parameters<typeof demoServer>[0], env: Record<string, string> = {}) => {
  const server = demoServer(mode, env);
  return { server, config: loadConfig({ ...env, ...server.env }) };
};

describe("demoServer", () => {
  it("replays the recorded topic at the demo pace, from emptied preview data", () => {
    const { server, config } = served("replay");

    expect(config).toMatchObject({
      providerProfile: "replay",
      demoTopic: RECORDED_TOPIC,
      replayLatency: DEMO_PACE,
      dataDir: resolve(".preview-data"),
    });
    expect(server.dataDir).toBe(config.dataDir);
  });

  it("keeps the preview's replay unpaced, in the same data as the replay demo", () => {
    const preview = served("preview").config;

    expect(preview).toMatchObject({ providerProfile: "replay", replayLatency: 0 });
    expect(preview.dataDir).toBe(served("replay").config.dataDir);
  });

  it("replays at another pace when the environment sets one", () => {
    expect(served("replay", configEnv({ replayLatency: 0.5 })).config.replayLatency).toBe(0.5);
  });

  it("replays the recorded topic whatever topic the environment chose", () => {
    expect(served("replay", configEnv({ demoTopic: "SQL basics" })).config.demoTopic).toBe(
      RECORDED_TOPIC,
    );
  });

  it("refuses the live demo without a key, and says where the key goes", () => {
    expect(() => demoServer("live", {})).toThrow(/MODEL_API_KEY.*\.env/);
    expect(() => demoServer("live", { MODEL_API_KEY: " " })).toThrow(/MODEL_API_KEY/);
  });

  it("runs live from fresh data of its own, on the recorded topic until one is chosen", () => {
    const { server, config } = served("live", KEY);

    expect(config).toMatchObject({
      providerProfile: "live",
      demoTopic: RECORDED_TOPIC,
      dataDir: resolve(".live-data"),
    });
    expect(server.dataDir).not.toBe(served("replay").server.dataDir);
  });

  it("runs live on the chosen topic", () => {
    const env = { ...KEY, ...configEnv({ demoTopic: "SQL basics" }) };

    expect(served("live", env).config.demoTopic).toBe("SQL basics");
  });

  it("leaves the key where it is: never in the settings it prints or passes on", () => {
    const { server } = served("live", KEY);

    expect(JSON.stringify(server)).not.toContain(KEY.MODEL_API_KEY);
  });
});
