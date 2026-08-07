# Phase 13 observability and load-test runbook

Status: **INSTRUMENTATION READY — DASHBOARDS AND SOAK NOT YET BUILT** — the service emits everything below and the load-test harness is written; the dashboards, the alert wiring, and the fifteen-minute staging run need a deployed Railway environment.

Owner: whoever holds the Railway project
Specification gate: Phase 13 — Security, reliability, and performance hardening

## Why there is no metrics endpoint

Fortuneness deliberately does not expose `/metrics`. The whole security posture of this service is "as little public surface as possible", and a scrape endpoint would be another publicly reachable route needing its own authentication, its own rate limit, and its own review — to carry data the process is already emitting.

Instead the process writes one structured record per interval to its ordinary log stream. Railway ships that stream to a log drain, and the dashboards and alert rules below are built there. The same records are what an operator reads directly during an incident, so there is one source of truth rather than a dashboard that can disagree with the logs.

## What the service emits

| Event                                           | Level | Interval                                  | Carries                                                                                                                                                         |
| ----------------------------------------------- | ----- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request completed`                             | info  | Per request                               | Method, path, status, duration, request ID                                                                                                                      |
| `metrics_flush`                                 | info  | `METRICS_FLUSH_INTERVAL_MS` (default 60s) | Route latency histograms, database transaction latency, the five-minute 5xx ratio, the fifteen-minute purchase-delivery ratio, the last reconciliation snapshot |
| `operational_alert`                             | warn  | On threshold breach                       | The alert name and the figures that tripped it                                                                                                                  |
| `egress_inventory`                              | info  | Once at startup                           | Every outbound destination the process is permitted to reach, with its enforcement class                                                                        |
| `fortune_draw_issued` / `fortune_draw_rejected` | info  | Per draw                                  | Allowance source and intention, or a stable rejection code                                                                                                      |
| `error_report_delivery_failed`                  | warn  | On failure                                | That reporting itself could not reach the ingest host                                                                                                           |
| `error_reports_dropped`                         | warn  | Per minute when capped                    | How many reports the per-minute cap discarded                                                                                                                   |
| `request exceeded its deadline`                 | warn  | On timeout                                | Method, route, request ID, the deadline                                                                                                                         |

Every record passes the scrubber in `apps/api/src/security/redaction.ts`. Metric keys are express route patterns, so `/v1/fortunes/:id` never becomes `/v1/fortunes/<a real draw id>`.

## What is never collected

No player identity, no session or refresh token, no Game Center proof, no Apple signed payload, no purchase token, no fortune text, alt text, or card identity, no request or response body, and no device or advertising identifier. This is what keeps the App Privacy answer for Diagnostics honest: the operational stream describes the service, not the player.

## Dashboards to build

Build four. Each panel names the field it reads from `metrics_flush`.

**1. Request health**

- Route p50/p95/p99 from `routes["<METHOD> <pattern>"]`, one series per route, with reference lines at 750 ms and 1500 ms.
- Request volume by route from `routes[...].count`.
- Five-minute 5xx ratio from `serverErrors.ratio`, with reference lines at 1% (Phase 13 objective) and 2% (Phase 16 halt condition).

**2. Database**

- Transaction p95 by operation from `database["<operation>"]`.
- Transaction volume and the failed share.
- Connection saturation: `DATABASE_POOL_MAX` against observed concurrency, watched during load tests.

**3. Commerce**

- Fifteen-minute purchase-delivery failure ratio from `purchaseDelivery.ratio`, reference line at 1%.
- Delivery volume from `purchaseDelivery.total`.
- Draw issuance by allowance source from `fortune_draw_issued`.
- Draw rejection by stable code from `fortune_draw_rejected`, watched for a rise in `CONTENT_UNAVAILABLE`.

**4. Reconciliation**

- Time since the last `reconciliation.completedAt`, reference line at 12 hours.
- `reconciliation.reconciled` per run, and `reconciliation.ran` false runs, which mean another instance held the lock.
- `reconciliation.durationMs` trend.

## Alert rules

| Alert                            | Condition                                               | Severity | Response                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER_ERROR_RATE_HIGH`         | Five-minute 5xx above 2%                                | Page     | Phase 16 halt condition. Stop any gradual rollout, then diagnose.                                                                                         |
| `PURCHASE_DELIVERY_FAILING`      | Fifteen-minute delivery failure above 1%                | Page     | Phase 16 halt condition. Purchases are money-bearing; unfinished transactions accumulate on devices until this clears.                                    |
| `RECONCILIATION_STALLED`         | No completed run in 12 hours                            | Page     | Reconciliation is the backstop that catches what the client and webhook both missed. Check the distributed lock and the App Store Server API credentials. |
| `DRAW_LATENCY_OBJECTIVE_MISSED`  | Draw p95 above 1500 ms in a flush interval              | Ticket   | Usually lock contention on the allowance transaction. Check `database` p95 first.                                                                         |
| `READ_LATENCY_OBJECTIVE_MISSED`  | Any non-draw route p95 above 750 ms in a flush interval | Ticket   | Check pool saturation and the archive cursor queries.                                                                                                     |
| Error-report delivery failing    | `error_report_delivery_failed` repeating                | Ticket   | Reporting is blind; the log stream is the only record until it clears.                                                                                    |
| Reports dropped                  | `error_reports_dropped` non-zero                        | Ticket   | Something is failing more than 30 times a minute. The cap is working; find the source.                                                                    |
| No `metrics_flush` for 5 minutes | Absence of the record                                   | Page     | The process is wedged or the background scheduler stopped.                                                                                                |

Alerts derived from a single flush interval are noisy by nature; require two consecutive intervals before paging on the two latency alerts.

## Load test

`apps/api/scripts/load-test.mjs` drives the Phase 13 acceptance run. It needs a deployed API, that API's database, and that API's access-token keyring. It cannot run offline and is not part of `npm run check`.

### What it drives

| Scenario        | Endpoint                      | Why                                                                          |
| --------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `state`         | `GET /v1/fortune/state`       | Read on every launch and after every action; the busiest authenticated route |
| `draw`          | `POST /v1/fortunes/draw`      | The row-locking allowance transaction                                        |
| `history`       | `GET /v1/fortunes`            | Keyset pagination over the archive                                           |
| `collection`    | `GET /v1/collection`          | The 78-slot discovery summary                                                |
| `me`            | `GET /v1/me`                  | Authoritative bootstrap                                                      |
| `authReject`    | `POST /v1/auth/game-center`   | The cost of _refusing_ an invalid proof at volume                            |
| `webhookReject` | `POST /v1/webhooks/app-store` | The cost of _refusing_ an unverifiable notification at volume                |

### Honest limits

- Sessions are synthetic. A real Game Center login needs a physical device, so the harness mints access tokens with the deployment's own keyring. Every request still takes the identical verification path; what is not measured is the login handshake itself.
- The two unauthenticated scenarios drive input that must be rejected. Measuring successful login and successful notification processing needs a device and Apple respectively, and belongs to Phases 15 and 16.
- The harness writes rows and consumes real allowance. Point it at staging only.

### Running the acceptance test

```bash
export DATABASE_URL='...'                       # the staging database
export JWT_ACCESS_KEYS_JSON='...'               # the staging access-token ring
export JWT_ACCESS_CURRENT_KEY_VERSION='v1'
export JWT_ISSUER='...' JWT_AUDIENCE='...'

npm run load-test --workspace @fortuneness/api -- \
  --base-url https://staging.fortuneness.app \
  --sessions 100 \
  --duration 900
```

The harness prints a per-scenario table, judges each objective, runs the database invariant checks, and exits non-zero if anything failed. Clean up afterwards:

```bash
npm run load-test --workspace @fortuneness/api -- --cleanup
```

Cleanup deletes only the accounts recorded in the run file this tool wrote.

### Acceptance thresholds

These are the Phase 13 acceptance criteria and are the same constants the running service alerts on.

| Objective                                     | Limit           |
| --------------------------------------------- | --------------- |
| `state` p95                                   | 750 ms          |
| `history` p95                                 | 750 ms          |
| `collection` p95                              | 750 ms          |
| `draw` p95                                    | 1500 ms         |
| Server error ratio across the run             | below 1%        |
| Draw, quota, ledger, and isolation invariants | zero violations |

A transport failure counts against the error budget exactly like a 5xx; a 4xx does not, because `NO_DRAWS_AVAILABLE` and `UNVIEWED_READING_PENDING` are the correct answers once a synthetic player has drawn.

## Rows a person must close

| #   | Row                                                                                       | Status  |
| --- | ----------------------------------------------------------------------------------------- | ------- |
| 1   | Railway log drain configured with the four dashboards above                               | NOT RUN |
| 2   | Alert rules wired with an on-call destination                                             | NOT RUN |
| 3   | Fifteen-minute, 100-session staging run meeting every objective                           | NOT RUN |
| 4   | Twenty-four-hour production-shaped soak (Phase 16 acceptance)                             | NOT RUN |
| 5   | Sentry project created, environments separated, retention agreed                          | NOT RUN |
| 6   | Confirmed that the emitted stream contains nothing the privacy worksheet does not declare | NOT RUN |
