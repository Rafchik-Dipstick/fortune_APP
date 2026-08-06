# Fortuneness API

This workspace owns the Node.js API that will run on Railway. It provides validated startup, request middleware, Prisma/PostgreSQL-backed `/health`, graceful shutdown, configuration-as-code, the canonical schema/migration/seed, and shared transaction infrastructure.

Build and start locally from the repository root after providing the variables in `.env.example` through the process environment:

```text
corepack npm run build --workspace @fortuneness/api
corepack npm run start --workspace @fortuneness/api
```

The process listens on Railway's injected `PORT`, reports ready only after `SELECT 1` succeeds, stops reporting ready as soon as shutdown begins, and closes HTTP/database resources on `SIGTERM` or `SIGINT`. Railway must be configured to read `/apps/api/railway.json`; no service has been linked or deployed yet.

Planned source boundaries follow the canonical specification:

- `src/db` — the process-owned Prisma runtime, database error mapping, bounded transaction retries, and ordered row-lock helpers.
- `src/middleware` — request identity, validation, authorization, limits, and errors.
- `src/routes` — `/health` and versioned HTTP route adapters.
- `src/services` — domain transactions independent of Express.
- `src/utils` — narrowly scoped infrastructure utilities.

Do not add secrets to `.env.example` or commit a populated `.env` file.
