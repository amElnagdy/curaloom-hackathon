// The demo's servers (#30), each built and started on port 3107 from emptied data:
//   node demo/run.ts replay   `pnpm demo:replay`  the recorded run, paced like a live one
//   node demo/run.ts preview  `pnpm preview`      the recorded run, unpaced, for checking the UI
//   node demo/run.ts live     `pnpm demo:live`    real model calls; needs MODEL_API_KEY in .env
//   node demo/run.ts reset    `pnpm demo:reset`   empties the demo's data under a running server
// docs/demo.md is the presenter's guide.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { configEnv, loadConfig } from "../src/config.ts";
import { RECORDED_TOPIC } from "./script.ts";

export type DemoMode = "replay" | "preview" | "live";
type Env = Record<string, string | undefined>;

export const DEMO_PORT = 3107;
// The recorded calls on the demo's path wait about 5 minutes in all; at this pace they wait about
// 1.5, so the whole demo, clicks included, takes under 4 minutes.
export const DEMO_PACE = 0.3;

const REPLAY_DATA = resolve(process.cwd(), ".preview-data");
const LIVE_DATA = resolve(process.cwd(), ".live-data");

// A server to start: the settings its config reads and the data folder emptied before it starts.
export type DemoServer = { mode: DemoMode; dataDir: string; env: Record<string, string> };

// The server for `mode`, given the launcher's environment (.env under the shell's). Throws when the
// live demo has no key.
export function demoServer(mode: DemoMode, env: Env): DemoServer {
  const chosen = loadConfig(env);
  if (mode === "live") {
    if (!chosen.modelApiKey) {
      throw new Error(
        "The live demo calls the models, so it needs MODEL_API_KEY: copy config/.env.example to .env and set it there.",
      );
    }
    const unchosen = chosen.demoTopic === loadConfig({}).demoTopic;
    return {
      mode,
      dataDir: LIVE_DATA,
      env: configEnv({
        providerProfile: "live",
        demoTopic: unchosen ? RECORDED_TOPIC : chosen.demoTopic,
        dataDir: LIVE_DATA,
      }),
    };
  }
  const pace = mode === "preview" ? 0 : chosen.replayLatency || DEMO_PACE;
  return {
    mode,
    dataDir: REPLAY_DATA,
    env: configEnv({
      providerProfile: "replay",
      demoTopic: RECORDED_TOPIC,
      replayLatency: pace,
      dataDir: REPLAY_DATA,
    }),
  };
}

function launcherEnv(): Env {
  const file = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
  return { ...file, ...process.env };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const { status } = spawnSync(command, args, { stdio: "inherit", env });
  if (status !== 0) process.exit(status ?? 1);
}

function main(command: string | undefined) {
  if (command === "reset") {
    for (const dir of [REPLAY_DATA, LIVE_DATA]) rmSync(dir, { recursive: true, force: true });
    console.log("The demo's data is emptied. Reload the browser tab to start the demo again.");
    return;
  }
  if (command !== "replay" && command !== "preview" && command !== "live") {
    console.error("Usage: node demo/run.ts replay | preview | live | reset");
    process.exit(2);
  }
  let server: DemoServer;
  try {
    server = demoServer(command, launcherEnv());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  rmSync(server.dataDir, { recursive: true, force: true });
  const settings = loadConfig(server.env);
  console.log(
    `${command} demo on http://localhost:${DEMO_PORT}: models ${settings.providerProfile}, pace ${settings.replayLatency}, topic "${settings.demoTopic}", data in ${server.dataDir}`,
  );
  const env = { ...process.env, ...server.env };
  run("next", ["build"], env);
  run("next", ["start", "-p", String(DEMO_PORT)], env);
}

if (import.meta.main) main(process.argv[2]);
