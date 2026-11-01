// A replay server for an e2e file: the built app with the settings of `pnpm preview` (replay,
// unpaced, the recorded topic) on emptied data in a temporary folder. A local .env cannot hide the
// demo bar or swap the notifier.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoServer } from "../demo/run.ts";
import { DEMO_SESSION_ID } from "../demo/session.ts";

const NEXT = join(process.cwd(), "node_modules/next/dist/bin/next");

export type ReplayServer = { url: string; stop(): Promise<void> };

export async function startReplay(port: number): Promise<ReplayServer> {
  if (!existsSync(".next/BUILD_ID")) throw new Error("No build to serve: run `pnpm build` first");
  const dir = mkdtempSync(join(tmpdir(), "e2e-replay-"));
  const url = `http://127.0.0.1:${port}`;
  const log = join(dir, "server.log");
  const env = {
    ...process.env,
    ...demoServer("preview", {}).env,
    DATA_DIR: join(dir, "data"),
    SIM_CLOCK: "true",
    NOTIFIER_ADAPTER: "simulated",
    NODE_ENV: "production",
  } as const;
  const out = openSync(log, "w");
  const server = spawn(process.execPath, [NEXT, "start", "-H", "127.0.0.1", "-p", String(port)], {
    env,
    stdio: ["ignore", out, out],
  });
  // A graceful stop would wait for the page's trace stream, which stays open until the page goes.
  async function stop() {
    server.kill("SIGKILL");
    if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
  try {
    for (let tries = 0; ; tries++) {
      if (server.exitCode !== null) {
        throw new Error(`The server exited (${server.exitCode}):\n${readFileSync(log, "utf8")}`);
      }
      if (tries === 120) throw new Error("The server did not answer within 30 s");
      const up = await fetch(`${url}/api/sessions/${DEMO_SESSION_ID}/trace`).catch(() => null);
      if (up?.ok) return { url, stop };
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (error) {
    await stop();
    throw error;
  }
}
