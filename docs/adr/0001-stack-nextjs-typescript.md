# ADR-001: One Next.js + TypeScript app

**Status:** Accepted (2026-10-27)

## Context

One developer, with coding agents, has until Nov 4 to build an Arabic RTL web UI, server-side agents that call the Meta Model API, a live trace panel and a simulated coach. #11 left the choice open between a TypeScript Next.js app and Python FastAPI with a separate frontend. The spikes in `spikes/` are Python, but they are throwaway.

## Decision

Build a single Next.js (App Router) app in TypeScript at the repo root, managed with pnpm.

- UI pages and server route handlers live in one app under `src/app`. Server-only code lives in `src/server`.
- Tooling: Biome (lint and format), Vitest (tests), `tsc` in strict mode, one GitHub Actions workflow (`pnpm lint`, `typecheck`, `test`, `build`).
- The `openai` SDK talks to `https://api.meta.ai/v1`, behind the provider layer (ADR-002).
- No monorepo. Split into packages only if a second deployable appears.

## Consequences

- One language and one toolchain for UI, agents, contracts and evals. JSON Schemas (#14) and their TS types sit next to the code that uses them.
- Server-Sent Events from a route handler cover the live trace panel without a separate server.
- Python spike code stays under `spikes/` and is not part of CI.
- Local Glimmer (#29) runs as a separate OpenAI-compatible server, so no Python is needed in the app.
