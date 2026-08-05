# Fortuneness Deploy Book

Last updated: 2026-08-05

This is the chronological build, verification, and deployment record for Fortuneness. It is maintained in the same commit as every logical implementation change. Entries are append-only apart from correcting inaccurate instructions, and secrets must never be recorded here.

The canonical product and technical requirements live in [`FORTUNENESS_SPEC.md`](./FORTUNENESS_SPEC.md). This book records how those requirements are being delivered; it does not replace them.

## Current delivery state

| Phase | State | Current gate |
| --- | --- | --- |
| Phase 0 — owner accounts, naming, and risk spikes | Blocked on owner/external actions | Apple, Expo/EAS, Railway, Google ADC, editorial ownership, and reviewer-access decisions remain open. |
| Phase 1 — repository and quality scaffold | In progress | Establish the monorepo, lock compatible toolchain versions, and make all root checks pass. |
| Phases 2–17 | Not started | Must follow the acceptance order in the specification. |

## Phase 0 deployment blockers

These items require owner credentials, external account changes, hardware, legal details, or product approval. Scaffold work may proceed, but no later acceptance gate may claim they are complete without recorded evidence.

- Confirm the public name, subtitle direction, support email, privacy-policy host, legal entity, and Apple developer account.
- Reserve the final bundle ID; `app.fortuneness` is only a proposal until availability is confirmed.
- Create the App Store Connect app, Game Center capability, IAP products, subscription group, Billing Grace Period configuration, and environment-specific V2 notification URLs.
- Record the exact StoreKit `billingPlanType` for the standard month-to-month Oracle+ product.
- Create the Expo/EAS project and credentials.
- Create isolated Railway staging and production projects and PostgreSQL services with an approved backup plan.
- Confirm Google ADC image-generation access.
- Assign the editorial owner and confirm capacity for at least 624 reviewed English fortune templates and 78 reviewed illustration descriptions.
- Complete the identity/commerce trust-boundary review and the physical-device Game Center/StoreKit spike.
- Close the Game Center-only reviewer-access gate or select Sign in with Apple before Phase 5.

## Environments

| Environment | API and database | Commerce trust | Mobile distribution | State |
| --- | --- | --- | --- | --- |
| Local | Local API and PostgreSQL | Xcode StoreKit only, with a local exported test certificate | Xcode development build | Scaffold pending |
| Staging | Isolated Railway service and PostgreSQL | App Store Sandbox only | EAS development/Internal TestFlight | External resources pending |
| Production | Isolated Railway service and PostgreSQL | App Store Production only | App Store build | External resources pending |

Environment trust must never cross: local Xcode certificates cannot enter Railway, preview builds cannot target production, and transaction environment is part of every commerce business key.

## Toolchain observations

- Initial Windows checkout: Node.js `v24.15.0`, npm `11.12.1`, Git `2.54.0.windows.1`.
- The exact repository pins and the Expo/React Native compatibility pair will be recorded in the Phase 1 scaffold commit.
- Native iOS compilation and the Phase 0 commerce spike require Mac/Xcode and a physical iOS device even though JavaScript and API work can proceed on Windows.

## Deployment procedure status

The deployment commands will be made executable and expanded as their owning phases land.

1. Install exactly from `package-lock.json` with `npm ci`.
2. Run root format, lint, typecheck, test, content-validation, asset-validation, and build gates.
3. Apply checked-in PostgreSQL migrations with `prisma migrate deploy`; production must never use `prisma db push`.
4. Deploy migrations before dependent API code when compatibility requires it.
5. Verify `/health` against the target environment without exposing dependency internals.
6. Verify the mobile profile points to the intended environment and commerce trust domain.
7. Record backup/recovery-point evidence before every production migration.
8. Record smoke-test, rollback, and monitoring evidence for every staging or production release.

No staging or production deployment has occurred yet.

## Chronological change log

### 2026-08-05 — Canonical specification baseline

- Added the implementation-ready Fortuneness product and technical specification.
- Added this deploy book before implementation so deployment state and verification evidence evolve with the code.
- Recorded Phase 0 external blockers without treating them as completed.
- Verified the initial checkout and local Node/npm/Git versions.

Verification:

```text
git status --short --branch
node --version
npm --version
git --version
```

Result: repository starts from the single upstream initial commit; the specification and deploy book are the first project artifacts.
