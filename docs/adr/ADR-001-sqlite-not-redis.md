# ADR-001: Use SQLite instead of Redis

**Status:** Accepted
**Date:** 2026-06-28

## Context

INFINI needs a message bus for multi-agent coordination. The agents
(Planner, Worker, Inspector) must communicate tasks, results, and
lessons without shared memory or race conditions.

The default choice for message buses in Python is Redis. Redis is fast,
battle-tested, and has pub/sub. But it requires:
- A running Redis server (infrastructure)
- Network configuration (complexity)
- Memory management (cost)
- A separate process to manage (operational burden)

For a CLI tool that should work with `pip install` and zero config,
Redis is the wrong default.

## Decision

Use SQLite in WAL mode as the message bus.

- `tasks` table: manager assigns, workers claim
- `messages` table: agent-to-agent communication
- `lessons` table: verbatim memory with FTS5 search

SQLite is:
- Zero-config (just a file)
- ACID-compliant. INFINI opens it in WAL mode. Write behaviour with several
  agent processes writing at once is an **unmeasured hypothesis**: the early
  `--plan` mode hit `database is locked` errors (see
  `docs/blog/scaling-infini.md`), and no concurrency benchmark exists.
- Built into Python's standard library
- **Unmeasured hypothesis:** that it serves 50+ concurrent agents on a
  t3.micro. No benchmark backs this number.

## Consequences

**Positive:**
- No external database service. `pip install infini-cli` installs the CLI
  and its Python dependencies.
- No infrastructure cost. The DB is a file on disk.
- Full SQL access for debugging. `sqlite3 ~/.infini/infini.db` and query.
- FTS5 gives us full-text search on lessons without a vector database.

**Negative:**
- Write contention under concurrency. WAL mode helps readers; concurrent
  writers can still block or fail with `database is locked`. Where the
  limit sits, and when a move to PostgreSQL or Redis would be needed, is
  unmeasured.
- No built-in pub/sub. We use polling (`task wait`) instead. For
  real-time dashboards, we'd need to add SQLite update hooks or
  switch to a streaming protocol.
- Single-machine only. No distributed coordination across hosts.
  For multi-host orchestration, a migration to NATS or Kafka is the
  natural next step.

## Attribution

The task/message table schema is adapted from
[Squad](https://github.com/mco-org/squad), which uses the same
SQLite-as-bus pattern for CLI-based agent coordination.
