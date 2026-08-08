# Production release checklist

Status: **CODE READY — EXTERNAL GATES OPEN** — every value below that the repository can decide is decided and committed. What remains needs a Railway project, a public API domain, and App Store Connect.

Owner: whoever holds the Railway project, the Expo account `infinityenglish`, and the Apple developer account.

This document is the single place that says what must be true before the first production build is submitted. It does not replace `docs/database-operations-runbook.md` (migrations), `docs/secret-rotation-runbook.md` (key material), or `docs/phase13-observability-runbook.md` (alerting); it names the moment each of those is invoked.

## 0. Decisions that must be made before anything else is configured

These are immutable once a build ships. Do not configure Railway or EAS until each is confirmed.

| Decision                     | Proposed value                                                                                  | Confirmed? |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| Production bundle identifier | `fortuness.app` — registered under team `YGR53JLX36`, set in `eas.json`                         | [x]        |
| Consumable product ID        | `app.fortuneness.fortunepack10`                                                                 | [ ]        |
| Subscription product ID      | `app.fortuneness.oracleplus.monthly`                                                            | [ ]        |
| Public API domain            | `https://fortuneapp-production.up.railway.app` — set in `eas.json`, baked into every binary     | [x]        |
| Marketing/legal domain       | `fortuneness.app` — must serve live privacy, terms, and support pages                           | [ ]        |
| Marketing version            | `app.config.ts` currently declares `0.1.0`; App Store first releases are conventionally `1.0.0` | [ ]        |

The bundle identifier is the hardest of these to change later: it is the Game Center audience, the StoreKit product namespace, and the App Store record. The API refuses a Game Center proof whose bundle ID disagrees with its own `APP_BUNDLE_ID`, so the two sides must be set from the same confirmed string.

The API URL is compiled into the binary. A domain change after submission requires a new build and a new review.

## 1. Railway production service

Set `NODE_ENV=production` and `DEPLOYMENT_ENVIRONMENT=production` together. The configuration parser refuses to start when they disagree, when the commerce environment does not match the deployment, or when any key ring names a version it does not contain — a misconfigured deploy fails at boot rather than serving with the wrong key.

### Injected by Railway

| Variable       | Source                                                             |
| -------------- | ------------------------------------------------------------------ |
| `PORT`         | Railway injects it; do not hard-code                               |
| `DATABASE_URL` | Reference the PostgreSQL service variable; never paste the literal |

### Must be set by hand

| Variable                                             | Production value                                   | Why it cannot default                                                        |
| ---------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `NODE_ENV`                                           | `production`                                       | —                                                                            |
| `DEPLOYMENT_ENVIRONMENT`                             | `production`                                       | Forces Production-only App Store trust                                       |
| `TRUST_PROXY`                                        | tested positive hop count, typically `1`           | Refused at `0` in production; the rate limiter would key every request alike |
| `APP_BUNDLE_ID`                                      | the confirmed identifier from §0                   | A mismatch rejects every Game Center login                                   |
| `APP_APPLE_ID`                                       | numeric App Apple ID from App Store Connect        | Needed for App Store Server API calls                                        |
| `APPLE_IAP_ENVIRONMENT`                              | `PRODUCTION`                                       | Refused as anything else in the production deployment                        |
| `APPLE_IAP_ISSUER_ID`                                | App Store Connect API issuer                       | Required in production; all three credentials or none                        |
| `APPLE_IAP_KEY_ID`                                   | App Store Connect API key ID                       | as above                                                                     |
| `APPLE_IAP_PRIVATE_KEY_BASE64`                       | base64 of the P-256 `.p8`                          | as above                                                                     |
| `IAP_ORACLE_PLUS_MONTHLY_EXPECTED_BILLING_PLAN_TYPE` | the exact value Apple reports for the monthly plan | Fails closed on a 12-month commitment plan misconfiguration                  |
| `CORS_ORIGINS`                                       | empty, or HTTPS origins only                       | Non-HTTPS origins are refused in production; a native app needs none         |

### Key rings — generate fresh, never reuse a development value

Eight independent rings, each a JSON object of version to 32 canonical base64 bytes, each paired with a `*_CURRENT_KEY_VERSION` naming a version present in that ring:

`GAME_CENTER_IDENTITY_HMAC_KEYS_JSON`, `JWT_ACCESS_KEYS_JSON`, `REFRESH_TOKEN_HMAC_KEYS_JSON`, `REFRESH_REPLAY_ENCRYPTION_KEYS_JSON`, `APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON`, `APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON`, `HISTORY_CURSOR_HMAC_KEYS_JSON`, `APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON`.

Generate each with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Start every ring at `v1`. Rotation procedure and per-ring wait periods are in `docs/secret-rotation-runbook.md`.

Also set `JWT_ISSUER=fortuneness-api` and `JWT_AUDIENCE=fortuneness-mobile`, matching whatever the mobile client expects.

### Must not be set in production

| Variable                              | Reason                                                           |
| ------------------------------------- | ---------------------------------------------------------------- |
| `GAME_CENTER_ALLOW_NONPERSISTENT_IDS` | Local-only; the parser refuses it outside the `local` deployment |

Everything not listed — the four deadlines, the four rate-limit budgets, pool size, TTLs, log level, metrics interval, and the two product IDs — has a production-appropriate default in `apps/api/src/config/environment.ts`. Set one only to deliberately depart from it.

Error reporting is off. `SENTRY_DSN` is optional and left unset, so nothing is transmitted and the reporter stays inert; the structured log stream is the only place a production fault appears. The variable name is the only Sentry-specific thing about it — the code posts to a DSN's envelope endpoint through the egress guard with no vendor SDK, so any Sentry-protocol ingest can be dropped in later without a code change.

### Service settings

This is a monorepo, and the API is a workspace inside it — not a standalone project directory.

| Railway setting     | Value                   | Why                                                                                                                                                                 |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root Directory      | `/` (leave empty)       | The build and start commands are `npm --workspace` invocations, and workspaces are only defined in the root `package.json`. Setting this to `apps/api` breaks both. |
| Railway Config File | `apps/api/railway.json` | Supplies the build command, start command, health check, and watch patterns as code                                                                                 |

Everything else — builder, build command, start command, health check path — comes from that config file. Do not also set them in the dashboard; the file is the source of truth.

The build command deliberately names three workspaces:

```text
corepack npm run build --workspace @fortuneness/api-contracts --workspace @fortuneness/fortune-content --workspace @fortuneness/api
```

`api-contracts` and `fortune-content` are both compiled because every package resolves to its own `dist/`, and `dist/` is gitignored — so on a fresh clone nothing is built yet. The running server imports only `api-contracts`, but `prisma/seed.ts` imports `fortune-content`, and a seed that cannot resolve its content package leaves the database with no cards to draw. `shared-types` is intentionally absent: only the mobile app uses it.

### Deploy sequence

1. Provision the PostgreSQL service and confirm the backup plan meets the 24-hour RPO, 4-hour RTO, and 30-recovery-point policy.
2. Set every variable above, then deploy. The service builds with `RAILPACK` per `apps/api/railway.json` and health-checks `/health`.
3. Run the production migration by hand, following the production section of `docs/database-operations-runbook.md`. Migrations are deliberately **not** part of the start command, so a bad migration cannot be applied by a restart loop.
4. Seed content only with an explicitly approved production-safe seed.
5. Run `corepack npm run db:invariants --workspace @fortuneness/api`.
6. Confirm the startup log's declared egress inventory matches `docs/phase13-observability-runbook.md`.
7. Build the four dashboards and arm the alert rules from that same runbook.

## 2. Apple configuration

1. Register the confirmed bundle identifier with the Game Center capability enabled.
2. Create the App Store Connect record; note the numeric App Apple ID for `APP_APPLE_ID`.
3. Create both in-app purchases with the confirmed product IDs. Configure the subscription as standard month-to-month pay-as-you-go, **not** a 12-month commitment plan, and record the exact `billingPlanType` Apple reports.
4. Enable Billing Grace Period for Sandbox and Production.
5. Point the App Store Server Notifications V2 production URL at the deployed webhook, and set the sandbox URL at the staging deployment if one exists.
6. Create the App Store Connect API key for the App Store Server API; base64 the `.p8` for `APPLE_IAP_PRIVATE_KEY_BASE64`.
7. Complete the App Privacy answers from `docs/app-privacy-worksheet.md`. The declared answers must stay true: no analytics SDK, no crash reporter, no tracking.
8. Prepare the reviewer-access artifact. Game Center as the primary identity provider in a non-game draws review scrutiny — the review notes must explain auto-provisioning, the daily rules, the exact free draw, the Sandbox pack and subscription, **Restore Purchases**, account switching, and deletion.

Export compliance is already answered in the binary: `app.config.ts` declares `ITSAppUsesNonExemptEncryption: false`, so App Store Connect stops asking on every upload.

## 3. EAS production build

`apps/mobile/eas.json` already pins the production profile to `EXPO_PUBLIC_APP_ENV=production`, `EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE=false`, and `EXPO_PUBLIC_API_URL=https://fortuneapp-production.up.railway.app`. These are public values compiled into the binary, so they belong in the committed profile rather than in EAS secret storage. Set the rest as EAS environment variables in the `production` environment:

| Variable                  | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| `APP_BUNDLE_ID`           | the confirmed identifier — the build **throws** without it |
| `EXPO_PUBLIC_PRIVACY_URL` | live HTTPS privacy page                                    |
| `EXPO_PUBLIC_TERMS_URL`   | live HTTPS terms page                                      |
| `EXPO_PUBLIC_SUPPORT_URL` | live HTTPS support page                                    |

All four URLs are validated at startup and must use HTTPS outside development, so a missing or `http://` value crashes the app on launch rather than silently pointing a shipped binary at localhost. The three legal pages must actually resolve — App Review follows them.

Before the first production build, confirm how the build number is resolved. `eas.json` sets `appVersionSource: "remote"` with `autoIncrement: true`, while `app.config.ts` reads `APP_BUILD_NUMBER` with a fallback of `1`. Decide which one owns the value and make the other stop claiming it.

Then:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

## 4. Release gate

The repository's own gate is one command, and it must pass on the exact commit being built:

```bash
corepack npm run check
```

That runs formatting, lint, per-workspace config checks, the privacy manifest validator, a high-severity dependency audit, Prisma schema validation, typecheck, tests, the OpenAPI contract check, content validation, card and audio asset validation, brand validation, the build, and the bundle-size budget.

Database integration tests are separate and need a real PostgreSQL instance:

```bash
corepack npm run test:db
```

## 5. Gates this repository cannot close

Each of these needs a person, a Mac, or a deployed environment. None may be marked done from a local checkout.

- [ ] Physical iPhone and iPad verification of Game Center login, the reveal, and both purchase paths against Sandbox.
- [ ] Restore Purchases verified on a second device and a second Apple ID.
- [ ] Account deletion verified end to end, including the purge delay and the tombstone behavior.
- [ ] Staging backup restore rehearsal with tombstone replay, per the database runbook.
- [ ] A secret rotation drill against a deployed environment, per the rotation runbook.
- [ ] Load test executed against Railway staging — never production, since it consumes real allowance.
- [ ] Accessibility pass at maximum Dynamic Type with VoiceOver.
- [ ] App Privacy answers confirmed by a person against the worksheet.
- [ ] Reviewer-access path rehearsed on a clean device.
