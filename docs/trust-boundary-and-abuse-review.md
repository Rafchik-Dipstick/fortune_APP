# Fortuneness Identity and Commerce Trust-Boundary Review

Status: Design review v1 — implementation evidence pending  
Reviewed: 2026-08-05  
Scope: Game Center identity, app sessions, account switching, fortune allowance, StoreKit delivery, App Store notifications, credit/refund accounting, offline caches, and account deletion

## Gate outcome

The specification contains a design control for every critical or high-severity threat identified in this review. No critical/high **design gap** remains open in this version. This is not implementation sign-off: every critical/high control below remains unverified until its owning phase produces the named automated, native, or operational evidence.

Phase 5 identity work cannot begin until the Game Center reviewer-access decision and physical-device proof spike are complete. Phase 9 commerce work cannot be accepted until the Xcode/Sandbox trust separation, product configuration, verified JWS spike, and App Store notification setup are proven. A failed proof, changed Apple platform requirement, or control that cannot be implemented reopens this review and blocks the owning phase.

## Security objectives

Fortuneness must preserve these invariants even when requests repeat, arrive concurrently, are delayed, or cross devices and Apple accounts:

1. One persistent Game Center subject maps to one current Fortuneness user; a temporary identifier never creates or selects an account.
2. Authentication proof, session, purchase, and financial ownership cannot be replayed or transferred to another player.
3. The active player can read and mutate only that player's profile, readings, cache, allowance, and caller-safe commerce state.
4. Allowance and credit changes commit exactly once and never produce a negative spendable balance.
5. Apple transaction ownership is immutable. Caller identity never overrides an existing transaction, subscription, or purchase-token owner.
6. A transaction is not acknowledged as safe to finish until its benefit or terminal no-benefit disposition commits durably.
7. Refund, renewal, expiration, revocation, and notification state converges from verified source facts, not arrival order.
8. Account deletion revokes normal access immediately and makes the financial benefit cutoff irreversible when purge wins.
9. Secrets, raw identity proofs, signed transaction payloads, private reading history, and recoverable purchase tokens do not enter logs or analytics.
10. Xcode, Sandbox, and Production commerce trust never crosses environments.

## Protected assets and data classes

| Asset                                             | Classification                       | Required protection                                                                                                                            |
| ------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Access and refresh tokens                         | Authentication secret                | Access token in memory where practical; refresh token in Keychain; hashes only on the server; redact everywhere.                               |
| Raw Game Center proof fields                      | Ephemeral identity evidence          | TLS in transit, bounded in memory, freshness/replay validation, discard after verification, never log.                                         |
| Game Center identifiers                           | Pseudonymous identity                | Versioned HMAC digests only after verification; alias is display-only.                                                                         |
| Apple JWS transaction/notification data           | Financial evidence                   | Verify Apple chain and environment before trust; retain normalized minimum; bounded encrypted raw notification retention only where specified. |
| `appAccountToken`                                 | Recoverable commerce ownership token | Random UUID distinct from internal IDs; encrypted raw value while active; versioned HMAC lookup; crypto-erasure at purge.                      |
| Credit ledger and grants                          | Financial entitlement record         | Append-only ledger, immutable grant ownership, database constraints, stable lock, audited support adjustments.                                 |
| Fortune readings and collection                   | Private account content              | User-scoped authorization, immutable issuance snapshots, account-partitioned cache, purge policy.                                              |
| Time zone and allowance periods                   | Authorization/quota input            | Server-owned canonical state, monotonic period IDs, row locking, device clock ignored.                                                         |
| Server signing/encryption/HMAC and Apple API keys | Production secret                    | Railway secret storage, least privilege, versioned rotation, never mobile or git.                                                              |
| Logs, metrics, backups                            | Operational data                     | Minimize/redact, environment separation, bounded retention, deletion-tombstone replay on restore.                                              |

Fortuneness does not need precise location, contacts, photos, microphone, health data, advertising IDs, cross-app tracking data, or a social graph. Adding any such collection requires a new review.

## Trust boundaries and principal flows

### TB-A — iOS process and local storage

GameKit and StoreKit results cross from Apple frameworks into local Swift Expo modules and then TypeScript. Only framework-verified StoreKit results are deliverable. Refresh tokens and the active purchase token belong in Keychain/account-scoped memory; reading cache belongs in account-partitioned SQLite with iOS Data Protection. A Game Center authentication-change event pauses mutations and clears the previous account's memory and SQLite partitions before a new session can become active.

### TB-B — mobile client to Fortuneness API

All traffic crosses an untrusted network and requires TLS. The server treats client locale/time zone as advisory, client IDs as untrusted, and client entitlement/balance calculations as non-authoritative. Zod rejects unknown request fields. Mutations use stable actor scoping, authorization rechecks inside the database transaction, body limits, rate limits, request IDs, and structured privacy-safe errors.

### TB-C — Game Center proof and Apple public-key retrieval

The proof bundle is untrusted until its freshness, replay fingerprint, persistent scoped ID, exact bundle ID, Apple certificate chain, signed-byte construction, and signature pass. The client-provided public-key URL is an SSRF input: only HTTPS/approved Apple hosts, public IP ranges, bounded size/time, cache-header-aware retrieval, and redirect revalidation are allowed.

### TB-D — StoreKit and Apple server data

Client delivery, `ONE_TIME_CHARGE`, App Store Server Notifications V2, and scheduled reconciliation are separate transports into one verified atomic application/reduction service. JWS signature, Apple chain, product/type, `billingPlanType`, bundle/app ID, and receiving environment are validated before database mutation. Transport identifiers deduplicate envelopes; environment-scoped transaction/original-transaction keys deduplicate business effects.

### TB-E — player identity versus financial ownership

Game Center selects a `User`; a separate random `FinancialSubject` owns purchases and ledger rows. A versioned purchase-token binding connects Apple data to that immutable financial owner. The authenticated caller may request delivery but cannot claim or move a transaction. Known other-owner delivery returns only `DELIVERED_TO_OTHER_ACCOUNT`; unknown ownership is quarantined and remains unfinished.

### TB-F — API services and PostgreSQL

PostgreSQL is authoritative. User-scoped writers lock `User` first; session writers follow `User → SessionFamily → RefreshToken`; flows needing financial state lock `FinancialSubject` last. Commerce application serializes first on its environment-scoped Apple business key, then locks the financial subject. Unique/check/foreign-key constraints are the final defense against duplicate or invalid effects.

### TB-G — operators, secrets, backups, and support tools

Operator access is a privileged boundary. Production secrets live only in Railway secret storage. Support time-zone or ledger corrections use authenticated, audited scripts with explicit reasons and compensating entries. Backup restoration cannot serve traffic until completed-deletion tombstones are replayed and financial/idempotency/deletion invariants pass.

## Abuse-case register

Status values mean:

- **Design-mitigated / evidence open** — the architecture defines a sufficient control, but implementation proof is still required.
- **External gate open** — owner/Apple/hardware evidence is missing and blocks the named phase.

| ID    | Abuse or failure case                                                                                                              | Severity | Required controls                                                                                                                                                                                                           | Owner / evidence                                                                                  | Status                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| AC-01 | Attacker supplies a private/link-local or redirecting Game Center public-key URL to scan internal services or substitute a key.    | Critical | HTTPS and approved-host allowlist; DNS/IP validation before and after redirects; private/link-local denial; response size/time cap; Apple chain validation.                                                                 | Phase 5 SSRF integration tests and outbound policy; Phase 13 penetration retest.                  | Design-mitigated / evidence open |
| AC-02 | Stale, replayed, malformed, wrong-bundle, or temporary-ID Game Center proof creates/takes over an account.                         | Critical | Persistent scoped-ID requirement; configured freshness/skew; bounded replay fingerprint; exact bundle ID; exact Apple signed bytes; signature/chain validation; atomic identity upsert.                                     | Phase 0 physical proof spike; Phase 5 negative/concurrency tests.                                 | External gate open               |
| AC-03 | Identity pepper loss/rotation makes a player unreachable or maps them to a second account.                                         | High     | Versioned current/previous HMAC keys; dual-read/current-write; post-auth backfill; removal blocked on migration audit.                                                                                                      | Phase 5 key-rotation fixture and operational runbook.                                             | Design-mitigated / evidence open |
| AC-04 | Lost/concurrent refresh response or stolen consumed token creates parallel sessions.                                               | High     | Hashed rotating tokens; unique predecessor/replacement; 120-second encrypted same-key replay receipt; different-key/late reuse revokes family; shared lock order and authoritative session checks.                          | Phase 5 lost-response, same-key race, and malicious-reuse tests.                                  | Design-mitigated / evidence open |
| AC-05 | Game Center player changes while requests/cache from the previous player remain active.                                            | Critical | Observe auth change; pause/cancel mutations; clear memory, Keychain-scoped purchase token, and SQLite partition; establish new bootstrap before resuming; caller-safe commerce response.                                    | Phase 5 switch tests; Phase 7 cache-isolation kill/race tests; Phase 9 switch-before-finish test. | Design-mitigated / evidence open |
| AC-06 | Concurrent taps/devices, reused keys, clock changes, or time-zone travel over-issue free/subscriber draws or double-debit credits. | Critical | Server clock; request-hashed actor-scoped idempotency; stable user/financial locks; one unviewed draw; monotonic allowance periods; database uniqueness/checks; bounded retries.                                            | Phase 4 constraints; Phase 6 50+ request/property/DST tests.                                      | Design-mitigated / evidence open |
| AC-07 | Client chooses a card, locale, seed, or paid “rarity,” or content failure consumes allowance.                                      | High     | Locale resolved from bootstrap; server cryptographic randomness; complete validated content matrix; selection and allowance in one transaction; `CONTENT_UNAVAILABLE` rolls back and reserves no key.                       | Phase 4 content validator; Phase 6 deterministic/statistical/rollback tests.                      | Design-mitigated / evidence open |
| AC-08 | A transaction from another App Store/Game Center pairing is granted to the active caller or leaks owner state.                     | Critical | Immutable `FinancialSubject`; token-binding history; existing business-key owner wins; caller cannot override; nonnil-token conflict quarantined; privacy-safe other-owner response; no transfers.                          | Phase 0 `appAccountToken` Sandbox spike; Phase 9 ownership/mismatch response-shape tests.         | External gate open               |
| AC-09 | Client/webhook/reconciliation replay or crash records a transaction without its grant, or grants it more than once.                | Critical | Verify before transaction; environment business-key lock; atomic transaction/grant/entitlement/disposition commit; unique keys; finish only after `safeToFinish`; same reducer on every transport.                          | Phase 9 crash-at-every-step and three-transport race matrix.                                      | Design-mitigated / evidence open |
| AC-10 | Forged, oversized, duplicated, delayed, or unknown App Store notification changes benefits or exhausts resources.                  | High     | Bounded raw body; outer and nested JWS verification; environment validation; durable envelope before 200; UUID transport dedupe; business-key effect dedupe; leases; bounded encrypted unknown-event retention.             | Phase 9 notification matrix and replay worker tests; Phase 13 load/penetration tests.             | Design-mitigated / evidence open |
| AC-11 | Out-of-order renewal/revoke/refund facts regress subscription access.                                                              | High     | Store independent verified facts; serialize by original transaction; greatest eligible `paidThrough`; source-time/authority/tie-break reduction; effective revocation persists until verified supersession.                 | Phase 9 permutation/property tests and App Store reconciliation fixtures.                         | Design-mitigated / evidence open |
| AC-12 | Partial/repeated/refund-before-delivery events make credit balance negative or silently consume a later purchase.                  | Critical | Per-grant milliunit reduction; FIFO draw allocation; append-only compensating ledger; nonnegative balance; unrecovered units are audit-only; later grants isolated; stable subject lock and constraints.                    | Phase 4 ledger constraints; Phase 6 balance properties; Phase 9 refund permutation matrix.        | Design-mitigated / evidence open |
| AC-13 | Xcode test certificate, Sandbox event, or Production event is accepted in another environment.                                     | Critical | Explicit receiver environment; environment in every business key; local-only Xcode certificate/config; staging Sandbox only; production Production only; startup fail-closed validation.                                    | Phase 0 Xcode/Sandbox spike; Phase 9 trust-crossover tests; deployment secret audit.              | External gate open               |
| AC-14 | Account deletion races draw/refresh/renewal, or late Apple events restore benefits after purge.                                    | Critical | Shared locks/session version; immediate session revocation; deletion-management-only token; purge locks user then subject; irreversible `benefitsDisabledAt`; closed-owner terminal disposition; no transfer on recreation. | Phase 12 lost-response/race/purge/late-event test matrix; restore tombstone drill.                | Design-mitigated / evidence open |
| AC-15 | A restored backup resurrects purged personal data or financial benefits.                                                           | Critical | Retained deletion tombstones outside ordinary restore set; replay before traffic; invariant checks; closed financial cutoff cannot reverse; staged restore rehearsal.                                                       | Phase 4 staging restore; quarterly operations runbook; Phase 12 purge evidence.                   | Design-mitigated / evidence open |
| AC-16 | SQLite, memory, logs, analytics, or crash reports expose another player's readings, tokens, proofs, JWS, or purchase token.        | Critical | Account partitions; immediate clear triggers; Data Protection; tokens only memory/Keychain; no JWS/token/proof/fortune text logging; PII scrubbing and retention; response stripping.                                       | Phase 7 cache isolation; Phase 9 response/log tests; Phase 13 redaction tests.                    | Design-mitigated / evidence open |
| AC-17 | Refund-consumption data is sent without informed consent or includes private reading content.                                      | High     | Deployment flag and versioned product-scoped consent both default off; revocable; accurate product-specific minimum; never fortune/card/raw identity; subscription omits `consumptionPercentage`.                           | Phase 9 payload tests; Phase 12 UI/privacy/legal approval.                                        | Design-mitigated / evidence open |
| AC-18 | Push capability or token collection expands the data/permission surface despite local-only reminders.                              | Medium   | Keep reminder local; no push-token backend; native config introspection must show no `aps-environment`; request notification permission only after explicit post-reading opt-in.                                            | Phase 1 introspection; Phase 12 reminder permission/terminated-zone tests.                        | Design-mitigated / evidence open |
| AC-19 | Support adjustment, time-zone override, or token repair becomes an unaudited entitlement bypass.                                   | High     | No client bypass; authenticated operator; explicit reason; immutable audit event; compensating ledger only; same-owner token repair only; least-privilege database role.                                                    | Phase 4 database roles; Phase 9/12 runbooks; Phase 13 access review.                              | Design-mitigated / evidence open |
| AC-20 | Secrets enter git, mobile code, screenshots, logs, or an overbroad CI/deployment context.                                          | Critical | Placeholder-only examples; secret scanning/dependency review; least-privilege CI; Railway/EAS environment separation; log redaction; rotation procedure.                                                                    | Phase 1 git/CI review; Phase 9 Railway secret audit; Phase 13 rotation/redaction tests.           | Design-mitigated / evidence open |

## Mandatory implementation checks by phase

| Phase       | Evidence required to keep this review closed                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 0     | Physical iPhone persistent Game Center proof; signed IPA Game Center entitlement; Xcode-versus-Sandbox JWS distinction; `appAccountToken` receipt; reviewer-access decision; final IDs/configuration record. |
| Phase 1     | Lockfile install, audit, lint/type/test/build gates; Expo Doctor; native config introspection; no unused push entitlement; no secret-bearing examples.                                                       |
| Phase 3     | Strict shared request/response contracts, request IDs, bounded bodies, rate-limit framework, privacy-safe errors, trust-proxy/CORS fail-closed configuration.                                                |
| Phase 4     | Identity/commerce/deletion schema, lock helpers, foreign keys, partial uniqueness, ledger checks/permissions, deterministic seed, restore and tombstone runbook.                                             |
| Phase 5     | Game Center signature/SSRF/replay/rotation/concurrency tests; rotating refresh-family tests; immediate authoritative invalidation; account switching.                                                        |
| Phase 6     | Allowance/time-zone/idempotency/unviewed-reading/selection properties and 50+ concurrent request tests.                                                                                                      |
| Phase 7     | Kill-point reveal recovery; account-partitioned memory/SQLite isolation; clear-on-switch/logout/deletion/mismatch.                                                                                           |
| Phase 9     | Apple JWS/environment/product/owner verification; atomic crash matrix; notification/reconciliation races; mismatch privacy; refund/subscription permutations; consent payloads.                              |
| Phase 12    | Recent-auth deletion gate; immediate revocation; purge cutoff; cancellation race; late Apple events; reminder permission and local-only scheduling.                                                          |
| Phase 13    | Penetration retest, secret rotation, dependency review, PII/log redaction, rate/timeout/outbound policy, load tests, operational alerts.                                                                     |
| Phase 15–16 | Environment/secret/notification URL audit, backup evidence, reviewer path rehearsal, rollback/switch drills, and production monitoring thresholds.                                                           |

## Review triggers

Repeat and version this review before implementation changes any of the following:

- launch identity provider, external-identity linking, or Game Center identifier choice;
- bundle ID, App Store products, subscription billing model, grace-period policy, Family Sharing, or transaction environment handling;
- `appAccountToken` storage/ownership/transfer policy;
- allowance priority, time-zone reset semantics, or paid credit accounting;
- live AI content generation, social/user-generated content, advertising/tracking, push notifications, or new device platforms;
- account deletion, retention, backup restore, consent, or privacy disclosures;
- lock order, idempotency scope, ledger mutability, or authoritative state ownership.

When a trigger occurs, add or amend abuse cases, identify newly affected tests/runbooks, and update the deploy book in the same commit.
