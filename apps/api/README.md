# Fortuneness API

This workspace owns the Node.js API that will run on Railway. Phase 1 establishes its compile/test boundary and safe environment template. Express startup, request middleware, `/health`, and Railway deployment arrive in Phase 3; Prisma schema and migrations arrive in Phase 4.

Planned source boundaries follow the canonical specification:

- `src/db` — Prisma singleton and transaction helpers.
- `src/middleware` — request identity, validation, authorization, limits, and errors.
- `src/routes` — `/health` and versioned HTTP route adapters.
- `src/services` — domain transactions independent of Express.
- `src/utils` — narrowly scoped infrastructure utilities.

Do not add secrets to `.env.example` or commit a populated `.env` file.
