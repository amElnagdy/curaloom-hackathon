# ADR-004: Simulated notifier and an injectable clock

**Status:** Accepted (2026-10-27)

## Context

The coach chases inactive learners over days and weeks. A 3-minute demo video has to show day 2, day 5 and day 17 within seconds. Sending real messages would need consent flows, provider accounts and review, and would contact real people.

## Decision

- **Clock:** all time-dependent code takes time from one clock module (`now`, `advance`, `set`). With `SIM_CLOCK=true` the clock is simulated and the UI can fast-forward it. Direct `Date.now()` or `new Date()` outside the clock module is forbidden, and a test enforces this (#23).
- **Notifier:** coach messages go through a channel-agnostic `Notifier` interface. The only adapter is `simulated`, which stores messages and shows them in an in-app phone-style inbox. WhatsApp and email exist only as documented stubs.
- **Consent:** consent, quiet hours and opt-out are enforced centrally, before any adapter is called. An inbound "stop" (`توقف`, `إيقاف` and variants) always opts out.
- Trace events carry both wall time and simulated time.

## Consequences

- The codebase contains no real network sends to learners.
- Coach behaviour can be tested deterministically by advancing the clock.
- A real channel later is one new adapter, not a rewrite.
