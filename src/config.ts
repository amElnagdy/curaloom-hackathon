// The only module that reads app-level settings. Everything else imports `config`.

export const PROVIDER_PROFILES = ["live", "record", "replay"] as const;
export type ProviderProfile = (typeof PROVIDER_PROFILES)[number];

export type Config = {
  appName: string;
  demoTopic: string;
  modelApiKey: string | undefined;
  providerProfile: ProviderProfile;
  simClock: boolean;
};

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parseProfile(value: string | undefined): ProviderProfile {
  if (value === undefined) return "live";
  if ((PROVIDER_PROFILES as readonly string[]).includes(value)) return value as ProviderProfile;
  throw new Error(
    `PROVIDER_PROFILE must be one of ${PROVIDER_PROFILES.join(", ")}; got "${value}"`,
  );
}

export function loadConfig(env: Env): Config {
  return {
    appName: read(env, "APP_NAME") ?? "CuraLoom",
    demoTopic: read(env, "DEMO_TOPIC") ?? "<DEMO_TOPIC>",
    modelApiKey: read(env, "MODEL_API_KEY"),
    providerProfile: parseProfile(read(env, "PROVIDER_PROFILE")),
    simClock: read(env, "SIM_CLOCK") !== "false",
  };
}

export const config: Config = loadConfig(process.env);
