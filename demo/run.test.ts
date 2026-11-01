import { createServer } from "node:net";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { configEnv, loadConfig } from "../src/config.ts";
import { DEFAULT_DEMO_PORT, DEMO_PACE, demoPort, demoServer, portFree } from "./run.ts";
import { RECORDED_TOPIC } from "./script.ts";

const KEY = { MODEL_API_KEY: "sk-test-secret" };

// What the started server's config reads: its own settings over the launcher's environment.
const served = (mode: Parameters<typeof demoServer>[0], env: Record<string, string> = {}) => {
  const server = demoServer(mode, env);
  return { server, config: loadConfig({ ...env, ...server.env }) };
};

describe("demoServer", () => {
  it("replays the recorded topic at the demo pace, from emptied replay data", () => {
    const { server, config } = served("replay");

    expect(config).toMatchObject({
      providerProfile: "replay",
      demoTopic: RECORDED_TOPIC,
      replayLatency: DEMO_PACE,
      dataDir: resolve(".replay-data"),
    });
    expect(server.dataDir).toBe(config.dataDir);
  });

  it("keeps the preview's replay unpaced, in data of its own", () => {
    const preview = served("preview").config;

    expect(preview).toMatchObject({
      providerProfile: "replay",
      replayLatency: 0,
      dataDir: resolve(".preview-data"),
    });
  });

  it("replays at another pace when the environment sets one", () => {
    expect(served("replay", configEnv({ replayLatency: 0.5 })).config.replayLatency).toBe(0.5);
  });

  it("replays unpaced when the environment sets the pace to 0", () => {
    expect(served("replay", configEnv({ replayLatency: 0 })).config.replayLatency).toBe(0);
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

describe("demoPort", () => {
  it("serves on 3107 when DEMO_PORT is unset or blank", () => {
    expect(DEFAULT_DEMO_PORT).toBe(3107);
    expect(demoPort({})).toBe(3107);
    expect(demoPort({ DEMO_PORT: " " })).toBe(3107);
  });

  it("serves on the port DEMO_PORT names", () => {
    expect(demoPort({ DEMO_PORT: "3118" })).toBe(3118);
    expect(demoPort({ DEMO_PORT: " 65535 " })).toBe(65535);
  });

  it.each(["80", "1023", "65536", "3118.5", "-3118", "31e2", "port"])(
    "refuses DEMO_PORT=%s and names the range",
    (value) => {
      expect(() => demoPort({ DEMO_PORT: value })).toThrow(/DEMO_PORT.*1024 to 65535/);
    },
  );
});

describe("two demos side by side", () => {
  it("builds each mode into its own folder from its own data, so one never empties another's", () => {
    const servers = [demoServer("replay", {}), demoServer("preview", {}), demoServer("live", KEY)];

    expect(servers.map((s) => s.buildDir)).toEqual([".next", ".next-preview", ".next-live"]);
    expect(new Set(servers.map((s) => s.dataDir)).size).toBe(3);
  });

  // On macOS a bind on 127.0.0.1 succeeds beside a server on 0.0.0.0 or ::, so only these catch it.
  it.each(["127.0.0.1", "0.0.0.0", "::", "::1"])(
    "finds the port taken by a server listening on %s, and free once it stops",
    async (host) => {
      const other = createServer();
      const listening = await new Promise<boolean>((done) => {
        other.once("error", () => done(false));
        other.listen(0, host, () => done(true));
      });
      if (!listening) return; // No IPv6 on this machine.
      const { port } = other.address() as { port: number };

      expect(await portFree(port)).toBe(false);
      await new Promise((done) => other.close(done));
      expect(await portFree(port)).toBe(true);
    },
  );
});
