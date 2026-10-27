// Role routing and prices from config/models.yaml (ADR-002).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const PROVIDERS = ["meta"] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type RoleConfig = { provider: ProviderName; model: string; reasoning?: ReasoningEffort };

// Token prices are USD per 1M tokens; unit prices are USD per image or per audio hour.
export type Price =
  | { input: number; cached_input: number; output: number }
  | { per_image: number }
  | { per_audio_hour: number };

export type Models = {
  roles: Record<string, RoleConfig>;
  prices: Record<string, Price>;
  tool_prices: { web_search: number };
};

export type Usage = {
  input?: number;
  cachedInput?: number;
  output?: number;
  searches?: number;
  images?: number;
  audioSeconds?: number;
};

const MODELS_PATH = join(import.meta.dirname, "../../../config/models.yaml");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ROLE_KEYS = ["provider", "model", "reasoning"];

// Exported so a caller that routes a model chosen at runtime (the eval CLI) gets the same checks.
export function parseRole(name: string, raw: unknown, prices: Record<string, Price>): RoleConfig {
  const fail = (msg: string): never => {
    throw new Error(`config/models.yaml: role ${name}: ${msg}`);
  };
  if (!isRecord(raw)) return fail("must be a mapping");
  const unknown = Object.keys(raw).find((key) => !ROLE_KEYS.includes(key));
  if (unknown) fail(`unknown key "${unknown}"; supported: ${ROLE_KEYS.join(", ")}`);
  const { provider, model, reasoning } = raw;
  if (!(PROVIDERS as readonly unknown[]).includes(provider)) fail(`unknown provider "${provider}"`);
  if (typeof model !== "string" || model === "") return fail("missing model");
  if (!Object.hasOwn(prices, model)) fail(`no price for "${model}" under prices`);
  if (reasoning !== undefined && !(REASONING_EFFORTS as readonly unknown[]).includes(reasoning)) {
    fail(`unknown reasoning "${reasoning}"`);
  }
  const role: RoleConfig = { provider: provider as ProviderName, model };
  if (reasoning !== undefined) role.reasoning = reasoning as ReasoningEffort;
  return role;
}

export function parseModels(text: string): Models {
  const raw: unknown = parse(text);
  if (!isRecord(raw) || !isRecord(raw.roles) || !isRecord(raw.prices)) {
    throw new Error("config/models.yaml: needs roles and prices mappings");
  }
  const prices = raw.prices as Record<string, Price>;
  const roles = Object.fromEntries(
    Object.entries(raw.roles).map(([name, role]) => [name, parseRole(name, role, prices)]),
  );
  const toolPrices = isRecord(raw.tool_prices) ? raw.tool_prices : {};
  return { roles, prices, tool_prices: { web_search: Number(toolPrices.web_search ?? 0) } };
}

export function loadModels(): Models {
  return parseModels(readFileSync(MODELS_PATH, "utf8"));
}

export function costUsd(models: Models, model: string, usage: Usage): number {
  const price = models.prices[model];
  if (!price) return 0;
  if ("per_image" in price) return (usage.images ?? 0) * price.per_image;
  if ("per_audio_hour" in price) return ((usage.audioSeconds ?? 0) / 3600) * price.per_audio_hour;
  const cached = usage.cachedInput ?? 0;
  const fresh = (usage.input ?? 0) - cached;
  const tokens =
    fresh * price.input + cached * price.cached_input + (usage.output ?? 0) * price.output;
  return tokens / 1_000_000 + (usage.searches ?? 0) * models.tool_prices.web_search;
}
