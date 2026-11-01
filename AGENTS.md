# AGENTS.md

## Setup and checks

```sh
pnpm install
cp config/.env.example .env   # add MODEL_API_KEY for live calls
pnpm check                    # lint, typecheck, test; the pre-commit hook runs it
pnpm dev
```

CI (`.github/workflows/ci.yml`) runs the same checks plus `pnpm build` and `pnpm e2e`, the presenter's walk in a browser, with no secrets.

To see the UI while the user's `pnpm dev` runs (Next allows one dev server per checkout), run `pnpm preview`. It builds and serves on port 3107 (`DEMO_PORT` moves it), replays the recorded responses on their sample topic, and keeps its own build in `.next-preview/` and its own data in `.preview-data/`, emptied on each start, so it can run beside `pnpm demo:replay` on another `DEMO_PORT`. `docs/demo.md` covers the demo's other servers, its reset and re-recording.

## Conventions

Read `docs/architecture.md` for the component map and layout, and the ADRs in `docs/adr/` that touch your area, before changing code.

- **Config:** read settings only through `src/config.ts`. The product name is not final. Take it and the demo topic from `config.appName` and `config.demoTopic`. `src/guards.test.ts` enforces this.
- **Models:** call models only through `createProvider()` in `src/server/providers/` (ADR-002), by a role from `config/models.yaml`. Feature code imports no model SDK and never calls the Meta API itself; `src/guards.test.ts` enforces this. Recorded responses for `replay` live in `demo/fixtures/responses/`.
- **Contracts:** entity shapes and types come from `contracts/index.ts` (ADR-006). Pass a contract to `provider.structured` and check model output with `validate()`. After changing an agent-output contract, run `pnpm fixtures:record` (live; it calls the model only for requests with no fixture), then `pnpm fixtures:prune`.
- **Time:** take time only from the clock module (ADR-004).
- **Agents:** an agent is `{name, output: <contract>, run(ctx, input)}`, run through `orchestrator.runStep` (pass a `key` such as `lesson:L2` when an agent runs more than once per session), which validates the output, retries once, saves it and traces the step. Read and write session state through `ctx.store`.
- **Trace:** every model call and tool call emits a trace event with `summary_ar` and `summary_en`. Model calls are traced by the provider; other tool calls and decisions go through `ctx.trace`. Keep big payloads in a blob (`payload_ref`).
- **Secrets:** keys come from `.env` only. Keep them out of code, fixtures, traces and logs.
- **Language:** learner-facing text is Arabic. Code, identifiers, commits and docs are English.
- **Tests:** Vitest, next to the code as `*.test.ts`. Test behaviour through the module's public interface.
- **Decisions:** record a hard-to-reverse choice as a new ADR in `docs/adr/`.
- **Licence:** the code is Apache-2.0 (`LICENSE`). It does not cover the recorded fixtures in `demo/fixtures/pages/` and `demo/fixtures/responses/`, which keep their sources' licences (`demo/fixtures/LICENSE.md`), or the third-party material in `THIRD_PARTY_NOTICES.md`.
- **Replay freeze:** from Nov 3, 2026, do not change anything that feeds a model request, such as a prompt, a contract, `config/models.yaml`, `demo/script.ts` or `demo/fixtures/`. Replay finds each recording by a hash of the full request, so such a change breaks the demo. `docs/release-checklist.md` ("Replay freeze") lists what is frozen and the checks to run before merging.

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
