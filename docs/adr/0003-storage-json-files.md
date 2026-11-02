# ADR-003: JSON files for the state store

**Status:** Accepted (2026-10-27)

## Context

Each learner session has a profile, a plan, lessons, quizzes, mastery records, coach events and trace events. State must survive a server restart (#13), and the demo needs a one-step reset to a seeded state (#23). There is one user at a time, in one server process, on one machine.

## Decision

- Store each session as JSON documents under `data/sessions/<session_id>/`, which is gitignored. Write a temp file, then rename it, so a crash never leaves a half-written file.
- Append trace events to `data/sessions/<session_id>/trace.jsonl`.
- Feature code uses a small `Store` interface (#13), never `fs` directly.
- Reset deletes the session's documents and its trace, and each reader falls back to the seed from `demo/fixtures/`, so the seed stays the one copy of the starting state. The emptied trace then records the reset, so the activity feed does not keep the previous run. (Amended 2026-10-29 for #23: the first version copied the seed over the session. Amended 2026-11-02 for #119: the 2026-10-29 version kept the trace.)

## Consequences

- No database, native module or migration. State can be read and diffed by hand.
- Unsafe with more than one writer process. Acceptable for a single-user demo. If that changes, swap the `Store` implementation for SQLite (`node:sqlite`) behind the same interface.
