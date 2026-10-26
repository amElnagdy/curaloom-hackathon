# ADR-002: All model access goes through one provider layer

**Status:** Accepted (2026-10-27)

## Context

Agents need chat with tools, structured output, web search with citations, transcription, image editing and segmentation. The demo must also run offline from recorded responses (#30), and a local Glimmer model may replace some roles (#29). Spike #7 found that `/responses` is the only Meta endpoint that supports every feature, including web search and SAM.

## Decision

- Feature code calls a provider interface (`chat`, `structured`, `webSearch`, `transcribe`, `imageEdit`, `segment`) that returns one normalised result shape. It never imports a model SDK. #12 defines the interface.
- Routing is by **role**, not by model: `config/models.yaml` maps each role (for example `agent_default`, `curriculum`, `judge`) to a provider, a model and parameters.
- The `PROVIDER_PROFILE` setting selects the mode:
  - `live` calls the API.
  - `record` calls the API and saves each response under `demo/fixtures`.
  - `replay` returns saved responses with no network.
- The Meta provider uses `/responses` as its main protocol.
- The provider layer owns retries, timeouts (at least 30 s), cost and token accounting, and emits a trace event for every call.

## Consequences

- Swapping a model or provider is a config change.
- The demo can run with no network and no key (`replay`).
- One place to change if Meta's response shapes differ from the docs. The shapes seen in spike #7 are recorded in `docs/spikes/api-access.md`.
