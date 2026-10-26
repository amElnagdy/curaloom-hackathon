# ADR-005: No embeddings or vector store; use long context

**Status:** Accepted (2026-10-27)

## Context

Agents need to ground lessons and quizzes in a handful of source excerpts per learner. A typical approach is retrieval over embeddings. Spike #7 showed that the Meta Model API lists no embedding model, and whether non-Meta models may be used is still an open question for #10.

## Decision

- Use no embeddings and no vector store. Put the relevant source excerpts, glossary entries and learner profile directly into the prompt.
- Keep excerpts short and cite each by `resource_id` and locator, so lessons can show the source side by side.
- Use web search on `/responses` (ADR-002) to discover new resources.

## Consequences

- No extra model, index or sync step, and every Meta call stays "Meta tooling".
- Prompt size grows with the number of excerpts. Spike #7 measured about 51k input tokens for one web-search query, so cost per call must be watched in the trace.
- If a course outgrows the context window, revisit this ADR.
