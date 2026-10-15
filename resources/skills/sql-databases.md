---
name: SQL and databases
description: Schemas, queries and migrations
tags: backend, database, sql, migrations
---
- Change the schema only through a new migration; never edit a migration that has already run.
- Make migrations safe to run on live data: add columns nullable or with defaults, backfill, then tighten.
- Always use parameterized queries.
- Add indexes for columns used in frequent `WHERE`, `JOIN` and `ORDER BY` clauses; check plans with `EXPLAIN`.
- Wrap multi-step writes in a transaction.
- Avoid N+1 queries: load related rows in one query or a batched one.
- Use the right types (timestamps with time zone, numeric for money) and constraints (NOT NULL, foreign keys, unique).
