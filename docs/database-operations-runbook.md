# Database migration, backup, and restore runbook

Scope: local development, Railway staging, and Railway production PostgreSQL for Fortuneness.

The checked-in Prisma migration history is authoritative. Never use `prisma db push` against staging or production. Never seed production unless a release plan explicitly identifies an approved production-safe content seed.

## Local isolated verification

Set `TEST_DATABASE_ADMIN_URL` to a PostgreSQL administrative database that may create and drop databases, then run:

```text
corepack npm run test:db
```

The harness generates a name under `fortuneness_test_*`, confirms that exact database does not exist, creates it from `template0`, runs `prisma migrate deploy`, seeds twice-safe content, executes database integration tests and read-only invariants, terminates only connections to that generated database, drops it, and confirms removal. The harness refuses caller-selected target names.

## Staging migration

1. Confirm the target is the isolated staging PostgreSQL service and that `DATABASE_URL` is injected rather than copied into a command, file, log, or ticket.
2. Confirm the migration artifact and application commit are the reviewed pair. Run `corepack npm run db:migrate:status --workspace @fortuneness/api`.
3. Create or confirm a restorable staging recovery point. Record provider backup identity, UTC time, source commit, and operator in the deployment evidence.
4. Stop write traffic when the migration is not verified as online-compatible.
5. Run `corepack npm run db:migrate:deploy --workspace @fortuneness/api`. Do not substitute `migrate dev` or `db push`.
6. Run the approved seed for that environment, then `corepack npm run db:invariants --workspace @fortuneness/api`.
7. Start the candidate API, verify `/health`, authentication/bootstrap, a keyed draw/replay, history, and environment-appropriate commerce smoke tests before restoring normal traffic.
8. Record migration output, invariant output, smoke evidence, and any rollback decision in `DEPLOY_BOOK.md` without credentials or personal data.

## Production migration

Production uses only `prisma migrate deploy`. Before the command, require a restorable recovery point that meets the approved 24-hour RPO, 4-hour RTO, and 30-recovery-point policy; a reviewed backward-compatible application/migration pair; a maintenance/rollback decision; staging evidence for the exact migration; and named incident ownership. If any prerequisite is missing, do not migrate.

Schema rollback is forward-only: restore the previous compatible application when the migration is backward-compatible, or apply a separately reviewed corrective migration. Never edit an applied migration and never use `db push` to improvise recovery.

## Backup restore rehearsal

1. Create a new isolated restore target; never overwrite staging or production during a rehearsal.
2. Record the source recovery point and restore-target identity. Restore the provider snapshot or a custom-format `pg_dump` produced with `--format=custom --no-owner --no-acl`.
3. Keep the restored service blocked from application traffic. Point only the rehearsal process at its injected `DATABASE_URL`.
4. Run `prisma migrate status`, then `prisma migrate deploy` to add any reviewed migrations newer than the recovery point.
5. Before traffic, replay the independently retained completed-deletion tombstones using the Phase 12 purge tooling. A restored user/identity/benefit linked to a completed tombstone is a failed rehearsal; do not serve the database.
6. Run `corepack npm run db:invariants --workspace @fortuneness/api` and targeted smoke tests. Verify the card/content matrix, ledger running balances, zero balance for closed financial subjects, migration history, deletion state, and application health.
7. Record achieved RPO/RTO, row-count/invariant evidence, tombstone replay evidence, operator, UTC timings, and cleanup. Destroy only the explicitly named isolated restore target after evidence is retained.

The staging restore rehearsal remains an external acceptance gate until Railway staging, provider backups, and the Phase 12 tombstone replay mechanism exist. Local migration and integrity tests do not substitute for that evidence.
