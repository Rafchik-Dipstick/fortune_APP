# Secret rotation runbook

Status: **PROCEDURE READY — NOT YET REHEARSED** — the rotation mechanics are implemented and tested; the drill itself needs a deployed Railway environment.

Owner: whoever holds the Railway project and App Store Connect keys
Specification gate: Phase 13 — Security, reliability, and performance hardening (AC-03, AC-20)

## Principles

1. **Every secret is versioned, and rotation is a two-step move.** Add the new version and make it current while the old version stays readable; remove the old version only after nothing can still present material signed or encrypted under it. There is no cutover during which both halves must change at once.
2. **Production secrets live only in Railway secret storage.** Never in git, never in the mobile bundle, never in a screenshot, never in this book.
3. **A rotation that cannot be reversed is not ready to run.** Keep the previous version in the ring until the wait period below has elapsed.
4. **The API fails closed on a malformed ring.** `parseApiEnvironment` refuses to start when the current version names a key that is not present, when a key is not exactly 32 canonical base64 bytes, or when the deployment and commerce environments disagree. A bad rotation stops the deploy rather than serving with the wrong key.

## The secrets

| Variable                                                                    | What it protects                      | Shape                  | Rotation style                                              | Wait before removing the old version                                            |
| --------------------------------------------------------------------------- | ------------------------------------- | ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GAME_CENTER_IDENTITY_HMAC_KEYS_JSON`                                       | Game Center identity digests          | Versioned 32-byte ring | Dual-read, current-write, post-auth backfill                | Until every active player has authenticated at least once under the new version |
| `JWT_ACCESS_KEYS_JSON`                                                      | Access and deletion-management tokens | Versioned 32-byte ring | Dual-read, current-write                                    | `JWT_ACCESS_TTL_SECONDS` plus a margin (default 15 min → wait 1 hour)           |
| `REFRESH_TOKEN_HMAC_KEYS_JSON`                                              | Refresh-token hashes                  | Versioned 32-byte ring | Dual-read, current-write                                    | `REFRESH_TOKEN_TTL_DAYS` (default 30 days)                                      |
| `REFRESH_REPLAY_ENCRYPTION_KEYS_JSON`                                       | 120-second replay receipts            | Versioned 32-byte ring | Dual-read, current-write                                    | 1 hour                                                                          |
| `APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON`                                          | Purchase-token lookup digests         | Versioned 32-byte ring | Dual-read, current-write, backfill on next binding          | Until the binding backfill audit reports zero rows on the old version           |
| `APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON`                                    | Active raw purchase tokens            | Versioned 32-byte ring | Dual-read, current-write, re-encrypt on write               | Until zero active tokens remain on the old version                              |
| `HISTORY_CURSOR_HMAC_KEYS_JSON`                                             | Signed archive cursors                | Versioned 32-byte ring | Dual-read, current-write                                    | 1 hour (cursors are short-lived by use)                                         |
| `APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON`                               | Bounded raw notification retention    | Versioned 32-byte ring | Dual-read, current-write                                    | `APP_STORE_NOTIFICATION_RAW_TTL_DAYS` (default 90 days)                         |
| `APPLE_IAP_PRIVATE_KEY_BASE64` + `APPLE_IAP_KEY_ID` + `APPLE_IAP_ISSUER_ID` | App Store Server API access           | Apple-issued P-256 key | Apple-side: create the new key, deploy, then revoke the old | 24 hours after the new key serves traffic without error                         |
| `SENTRY_DSN`                                                                | Error-report ingest                   | Vendor DSN             | Replace outright                                            | None; it is not a decryption key                                                |
| `DATABASE_URL`                                                              | Database credentials                  | PostgreSQL URL         | Rotate the role password in Railway, then redeploy          | None; connections re-establish                                                  |

Crypto-erasure at account purge depends on the _active_ purchase-token encryption key. Never remove an encryption key version while any non-purged row still references it: doing so turns a recoverable token into an unreadable one and breaks the audit, not the privacy guarantee.

## Generating a key

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Each ring is a JSON object of version → base64 key. Version names match `^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$`. Use a monotonic scheme such as `v1`, `v2`.

## Routine rotation

Run this per ring. Do not rotate more than one ring per deploy unless responding to an incident.

1. **Record the start.** Open a change note: which ring, why, who, and the planned removal date.
2. **Add the new version.** In Railway, set the ring to include both versions, leaving `*_CURRENT_KEY_VERSION` on the old one:
   `{"v1":"<old>","v2":"<new>"}`
3. **Deploy and verify.** `/health` returns ready; the startup log shows no configuration failure. Nothing has changed behaviourally yet — the service can now _read_ v2.
4. **Promote.** Set `*_CURRENT_KEY_VERSION` to `v2`. Deploy. New material is written under v2; existing material under v1 still verifies.
5. **Wait.** Observe the wait period in the table. For the identity and purchase-token rings, wait on the backfill audit rather than the clock.
6. **Confirm nothing depends on the old version.** For identity and purchase-token rings, run the invariant check:
   `npm run db:invariants --workspace @fortuneness/api`
7. **Remove the old version.** Set the ring to `{"v2":"<new>"}`. Deploy. Verify `/health` and one authenticated read.
8. **Close the change note** with the removal timestamp.

Rolling back between steps 2 and 6 is safe: revert `*_CURRENT_KEY_VERSION` and redeploy. After step 7 it is not — material written under v2 cannot be read without v2.

## Emergency rotation

Use when a secret is believed exposed.

1. Disable new purchase initiation and, if the exposure touches identity or sessions, new draws, using the Phase 16 server-controlled switches. Delivery, restore, refunds, notifications, and reconciliation must keep running.
2. Perform steps 2 through 4 above in a single deploy: add the new version and promote it together.
3. For `JWT_ACCESS_KEYS_JSON` or `REFRESH_TOKEN_HMAC_KEYS_JSON`, remove the exposed version immediately rather than waiting. This revokes every session signed under it; players re-authenticate through Game Center. Accept that cost — a stolen signing key is a session-forgery key.
4. For `APPLE_IAP_PRIVATE_KEY_BASE64`, revoke the key in App Store Connect _first_, then deploy the replacement. Reconciliation and consumption calls fail in the gap; both are retried on their own schedules and neither is money-bearing on its own.
5. Re-enable the switches only after one full reconciliation tick completes cleanly.
6. Record the exposure, the window, and the affected material. If player data may have been readable, the privacy owner decides on notification.

## Dependency audit

`npm run audit:dependencies` fails the release gate on any high or critical advisory and runs as part of `npm run check`. When it fires:

1. Prefer upgrading the direct dependency. The repository pins exact versions, so update the pin and the lockfile together.
2. If the advisory is in a transitive package with no upstream fix, add an `overrides` entry pinning the fixed version and record why in the change note.
3. Never silence the gate to ship. If a finding is genuinely not exploitable here, record the reasoning in the change note and re-check it at the next release, rather than removing the check.

## Access review

Perform with every rotation and at least quarterly:

- Railway project members, and whether each still needs production access.
- App Store Connect key holders and their roles.
- Database roles: the API role must not own schema, and support tooling must use a separate audited role.
- GitHub repository and Actions secrets: CI needs no production secret.

## Rows a person must close

| #   | Row                                                                            | Status  |
| --- | ------------------------------------------------------------------------------ | ------- |
| 1   | One rehearsed routine rotation of the access-token ring in staging, end to end | NOT RUN |
| 2   | One rehearsed emergency rotation in staging, including the switch drill        | NOT RUN |
| 3   | Railway secret inventory matches the table above with no extras                | NOT RUN |
| 4   | Confirmed least-privilege database roles                                       | NOT RUN |
| 5   | First quarterly access review recorded                                         | NOT RUN |
