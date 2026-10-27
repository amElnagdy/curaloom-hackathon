# ADR-006: Contracts are TypeBox schemas that double as strict response formats

**Status:** Accepted (2026-10-27)

## Context

Agents exchange profiles, plans, lessons, glossary entries, quizzes and coach events (#14). The same shapes must be TypeScript types, runtime validators for the orchestrator's guardrail (#13), and `json_schema` response formats that Meta accepts in strict mode. Spike #7 found that recursive schemas return 400.

## Decision

- Write each contract once in `contracts/index.ts` with TypeBox. A TypeBox schema is plain JSON Schema, so the object sent to Meta is the object in the code. Types come from `Static<>`, with no codegen step. `validate()` and `contractErrors()` check values at runtime.
- Every contract follows strict-mode rules, which `contracts/contracts.test.ts` enforces:
  - no `$ref` and no recursion;
  - every property required;
  - `additionalProperties: false`;
  - an optional value is nullable rather than omitted;
  - nesting is at most 5 objects deep.
- Every agent-output contract has a smoke test that sends it to Meta as a strict response format. The responses are recorded under `demo/fixtures/responses/` and replayed in CI.
- Fields the code must own say so in their `description`, for example `licence.verified`. A model asked to fill them claims success it has not checked.

## Consequences

- Changing an agent-output contract changes the request, so its replay test fails until `pnpm fixtures:record` re-records it. That run makes live calls and costs about $0.10.
- Free-form maps cannot be expressed. Use arrays of `{key, value}` objects, for example `diagnostic.scores`.
