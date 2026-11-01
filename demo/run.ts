// The demo's servers (#30), each built and started on port 3107, or DEMO_PORT, from emptied data:
//   node demo/run.ts replay   `pnpm demo:replay`  the recorded run, paced like a live one
//   node demo/run.ts preview  `pnpm preview`      the recorded run, unpaced, for checking the UI
//   node demo/run.ts live     `pnpm demo:live`    real model calls; needs MODEL_API_KEY in .env
//   node demo/run.ts reset    `pnpm demo:reset`   empties the demo's data under a running server
// docs/demo.md is the presenter's guide.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { configEnv, loadConfig } from "../src/config.ts";
import { RECORDED_TOPIC } from "./script.ts";

export type DemoMode = "replay" | "preview" | "live";
type Env = Record<string, string | undefined>;

// DEMO_PORT moves a demo off this port, so a second one can run beside it.
export const DEFAULT_DEMO_PORT = 3107;
// Only this machine reaches the demo: live mode spends on the models, and no route asks who calls it.
export const DEMO_HOST = "127.0.0.1";
// The recorded calls on the demo's path wait about 5 minutes in all; at this pace they wait about
// 1.5, so the whole demo, clicks included, takes under 4 minutes.
export const DEMO_PACE = 0.3;

// Each mode builds into its own folder and keeps its own data, so two demos on different ports
// leave each other alone: a build empties its folder first, and a start empties its data.
// next.config.ts reads the build folder.
const FOLDERS: Record<DemoMode, { build: string; data: string }> = {
  replay: { build: ".next", data: ".replay-data" },
  preview: { build: ".next-preview", data: ".preview-data" },
  live: { build: ".next-live", data: ".live-data" },
};
const dataOf = (mode: DemoMode) => resolve(process.cwd(), FOLDERS[mode].data);

// A server to start: the settings its config reads, the data folder emptied before it starts, and
// the folder Next builds it into.
export type DemoServer = {
  mode: DemoMode;
  dataDir: string;
  buildDir: string;
  env: Record<string, string>;
};

// The port DEMO_PORT names, or the default. Throws unless it is a whole number from 1024 to 65535.
export function demoPort(env: Env): number {
  const raw = env.DEMO_PORT?.trim();
  if (!raw) return DEFAULT_DEMO_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535) {
    throw new Error(`DEMO_PORT must be a whole number from 1024 to 65535, not "${raw}".`);
  }
  return port;
}

// Whether `port` is free for the demo. A bind on the demo's host is not enough: on macOS it succeeds
// beside a server listening on 0.0.0.0 or ::, and the two then share the port, so a browser on
// localhost can reach the other server. A server that answers on either loopback address takes it.
export async function portFree(port: number): Promise<boolean> {
  const bound = await new Promise<boolean>((done) => {
    const probe = createServer()
      .once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true)));
    probe.listen(port, DEMO_HOST);
  });
  if (!bound) return false;
  const answered = await Promise.all(["127.0.0.1", "::1"].map((host) => answers(host, port)));
  return !answered.includes(true);
}

// Whether a server accepts a connection on host:port. Loopback refuses at once when none listens.
function answers(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port, timeout: 10_000 });
    const end = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.once("connect", () => end(true));
    socket.once("timeout", () => end(false));
    socket.once("error", () => end(false));
  });
}

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
      dataDir: dataOf(mode),
      buildDir: FOLDERS[mode].build,
      env: configEnv({
        providerProfile: "live",
        demoTopic: unchosen ? RECORDED_TOPIC : chosen.demoTopic,
        dataDir: dataOf(mode),
      }),
    };
  }
  const pace = mode === "preview" ? 0 : chosen.replayLatency || DEMO_PACE;
  return {
    mode,
    dataDir: dataOf(mode),
    buildDir: FOLDERS[mode].build,
    env: configEnv({
      providerProfile: "replay",
      demoTopic: RECORDED_TOPIC,
      replayLatency: pace,
      dataDir: dataOf(mode),
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

async function main(command: string | undefined) {
  if (command === "reset") {
    for (const mode of Object.keys(FOLDERS) as DemoMode[]) {
      rmSync(dataOf(mode), { recursive: true, force: true });
    }
    console.log("The demo's data is emptied. Reload the browser tab to start the demo again.");
    return;
  }
  if (command !== "replay" && command !== "preview" && command !== "live") {
    console.error("Usage: node demo/run.ts replay | preview | live | reset");
    process.exit(2);
  }
  let server: DemoServer;
  let port: number;
  try {
    const launcher = launcherEnv();
    server = demoServer(command, launcher);
    port = demoPort(launcher);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  // Checked before the build, which takes a minute, rather than left to Next's error after it.
  if (!(await portFree(port))) {
    console.error(`Port ${port} is in use, perhaps by another demo. Stop it, or set DEMO_PORT.`);
    process.exit(1);
  }
  rmSync(server.dataDir, { recursive: true, force: true });
  const settings = loadConfig(server.env);
  console.log(
    `${command} demo on http://${DEMO_HOST}:${port}: models ${settings.providerProfile}, pace ${settings.replayLatency}, topic "${settings.demoTopic}", data in ${server.dataDir}`,
  );
  const env = { ...process.env, ...server.env, NEXT_DIST_DIR: server.buildDir };
  run("next", ["build"], env);
  run("next", ["start", "-H", DEMO_HOST, "-p", String(port)], env);
}

if (import.meta.main) await main(process.argv[2]);
