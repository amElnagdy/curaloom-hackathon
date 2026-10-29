# AGENTS.md

## Setup and checks

```sh
pnpm install
cp config/.env.example .env   # add MODEL_API_KEY for live calls
pnpm check                    # lint, typecheck, test: run before every commit
pnpm dev
```

CI (`.github/workflows/ci.yml`) runs the same checks plus `pnpm build`, with no secrets.

## Conventions

Read `docs/architecture.md` for the component map and layout, and the ADRs in `docs/adr/` that touch your area, before changing code.

- **Config:** read settings only through `src/config.ts`. The product name and demo topic are not final; take them from `config.appName` and `config.demoTopic`. `src/guards.test.ts` enforces this.
- **Models:** call models only through `createProvider()` in `src/server/providers/` (ADR-002), by a role from `config/models.yaml`. Feature code imports no model SDK and never calls the Meta API itself; `src/guards.test.ts` enforces this. Recorded responses for `replay` live in `demo/fixtures/responses/`.
- **Contracts:** entity shapes and types come from `contracts/index.ts` (ADR-006). Pass a contract to `provider.structured` and check model output with `validate()`. After changing an agent-output contract, run `pnpm fixtures:record` (live, about $0.15).
- **Time:** take time only from the clock module (ADR-004).
- **Agents:** an agent is `{name, output: <contract>, run(ctx, input)}`, run through `orchestrator.runStep` (pass a `key` such as `lesson:L2` when an agent runs more than once per session), which validates the output, retries once, saves it and traces the step. Read and write session state through `ctx.store`.
- **Trace:** every model call and tool call emits a trace event with `summary_ar` and `summary_en`. Model calls are traced by the provider; other tool calls and decisions go through `ctx.trace`. Keep big payloads in a blob (`payload_ref`).
- **Secrets:** keys come from `.env` only. Keep them out of code, fixtures, traces and logs.
- **Language:** learner-facing text is Arabic. Code, identifiers, commits and docs are English.
- **Tests:** Vitest, next to the code as `*.test.ts`. Test behaviour through the module's public interface.
- **Decisions:** record a hard-to-reverse choice as a new ADR in `docs/adr/`.
- **Licence:** the repo has no `LICENSE` file yet. #32 picks one before the public copy; the placeholder default is MIT or Apache-2.0.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for amElnagdy/curaloom (`gh` CLI); epics use native sub-issues, dependencies use native blocked-by links. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
