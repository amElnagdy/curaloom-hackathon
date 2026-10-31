// The only module that reads app-level settings. Everything else imports `config`.

import { resolve } from "node:path";

export const PROVIDER_PROFILES = ["live", "record", "replay"] as const;
export type ProviderProfile = (typeof PROVIDER_PROFILES)[number];

// Notifier channels (ADR-004). Only `simulated` sends anything; the others are documented stubs.
export const NOTIFIER_ADAPTERS = ["simulated", "whatsapp", "email"] as const;
export type NotifierAdapterName = (typeof NOTIFIER_ADAPTERS)[number];

export type Config = {
  appName: string;
  demoTopic: string;
  modelApiKey: string | undefined;
  providerProfile: ProviderProfile;
  simClock: boolean;
  notifierAdapter: NotifierAdapterName;
  // Dev-only pages, routes and buttons (the dummy run, /dev/bidi): on unless this is a production build.
  devTools: boolean;
  // Where sessions, traces and the cache live. A second server (`pnpm preview`) sets its own, so it
  // never writes into the dev server's.
  dataDir: string;
  // In replay, each recorded reply waits its recorded latency times this, so a demo paces like a
  // live run (#30). 0 answers at once.
  replayLatency: number;
};

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parseChoice<const T extends readonly string[]>(
  name: string,
  choices: T,
  value: string | undefined,
  fallback: T[number],
): T[number] {
  if (value === undefined) return fallback;
  if ((choices as readonly string[]).includes(value)) return value as T[number];
  throw new Error(`${name} must be one of ${choices.join(", ")}; got "${value}"`);
}

function parsePace(name: string, value: string | undefined): number {
  if (value === undefined) return 0;
  const pace = Number(value);
  if (Number.isFinite(pace) && pace >= 0) return pace;
  throw new Error(`${name} must be a number of 0 or more; got "${value}"`);
}

export function loadConfig(env: Env): Config {
  return {
    appName: read(env, "APP_NAME") ?? "CuraLoom",
    demoTopic: read(env, "DEMO_TOPIC") ?? "<DEMO_TOPIC>",
    modelApiKey: read(env, "MODEL_API_KEY"),
    providerProfile: parseChoice(
      "PROVIDER_PROFILE",
      PROVIDER_PROFILES,
      read(env, "PROVIDER_PROFILE"),
      "live",
    ),
    simClock: read(env, "SIM_CLOCK") !== "false",
    notifierAdapter: parseChoice(
      "NOTIFIER_ADAPTER",
      NOTIFIER_ADAPTERS,
      read(env, "NOTIFIER_ADAPTER"),
      "simulated",
    ),
    devTools: read(env, "NODE_ENV") !== "production",
    dataDir: resolve(process.cwd(), read(env, "DATA_DIR") ?? "data"),
    replayLatency: parsePace("REPLAY_LATENCY", read(env, "REPLAY_LATENCY")),
  };
}

type ServerSettings = Partial<
  Pick<Config, "demoTopic" | "providerProfile" | "replayLatency" | "dataDir">
>;

// The environment that `loadConfig` reads back as `settings`: how a launcher (`demo/run.ts`) sets up
// a server without naming its variables.
export function configEnv(settings: ServerSettings): Record<string, string> {
  const names: Record<keyof ServerSettings, string> = {
    demoTopic: "DEMO_TOPIC",
    providerProfile: "PROVIDER_PROFILE",
    replayLatency: "REPLAY_LATENCY",
    dataDir: "DATA_DIR",
  };
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      names[key as keyof ServerSettings],
      String(value),
    ]),
  );
}

export const config: Config = loadConfig(process.env);
