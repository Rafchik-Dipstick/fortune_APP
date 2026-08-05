# Fortuneness Deploy Book

Last updated: 2026-08-05

This is the chronological build, verification, and deployment record for Fortuneness. It is maintained in the same commit as every logical implementation change. Entries are append-only apart from correcting inaccurate instructions, and secrets must never be recorded here.

The canonical product and technical requirements live in [`FORTUNENESS_SPEC.md`](./FORTUNENESS_SPEC.md). This book records how those requirements are being delivered; it does not replace them.

## Current delivery state

| Phase                                             | State                             | Current gate                                                                                                                         |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 0 — owner accounts, naming, and risk spikes | Blocked on owner/external actions | Apple, Expo/EAS, Railway, Google ADC, editorial ownership, and reviewer-access decisions remain open.                                |
| Phase 1 — repository and quality scaffold         | In progress                       | JavaScript/API/mobile scaffold is present; native modules, entitlement evidence, EAS linkage, and signed device builds remain gated. |
| Phase 2 — design system and adaptive slice        | In progress                       | Coded fixtures are underway; three-card art/content and real-device visual acceptance remain open.                                   |
| Phases 3–17                                       | Not started                       | Must follow the acceptance order in the specification.                                                                               |

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

| Environment | API and database                        | Commerce trust                                              | Mobile distribution                 | State                      |
| ----------- | --------------------------------------- | ----------------------------------------------------------- | ----------------------------------- | -------------------------- |
| Local       | Local API and PostgreSQL                | Xcode StoreKit only, with a local exported test certificate | Xcode development build             | Scaffold pending           |
| Staging     | Isolated Railway service and PostgreSQL | App Store Sandbox only                                      | EAS development/Internal TestFlight | External resources pending |
| Production  | Isolated Railway service and PostgreSQL | App Store Production only                                   | App Store build                     | External resources pending |

Environment trust must never cross: local Xcode certificates cannot enter Railway, preview builds cannot target production, and transaction environment is part of every commerce business key.

## Toolchain observations

- Initial Windows checkout: Node.js `v24.15.0`, npm `11.12.1`, Git `2.54.0.windows.1`.
- Repository toolchain selection: Node.js `24.18.0` in `.nvmrc` and npm `11.19.0` in `packageManager`. Package engines accept the tested Node 24/npm 11 release lines so patch updates remain possible without widening to a new major.
- Shared quality tooling is exactly locked: TypeScript `6.0.3`, ESLint `10.8.0`, typescript-eslint `8.66.0`, Prettier `3.9.6`, and Vitest `4.1.10`.
- Expo SDK `57.0.10` is the selected stable mobile line; the compatible React Native and React pins land with the mobile workspace commit.
- Native iOS compilation and the Phase 0 commerce spike require Mac/Xcode and a physical iOS device even though JavaScript and API work can proceed on Windows.

## Deployment procedure status

The deployment commands will be made executable and expanded as their owning phases land.

1. Resolve the repository-selected npm through Corepack and install exactly from `package-lock.json` with `corepack npm ci`.
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

### 2026-08-05 — Phase 1 workspace and quality foundation

- Added npm workspaces, strict shared TypeScript rules, ESLint, Prettier, EditorConfig, ignore rules, and exact package-manager/tooling selections.
- Explicitly allowlisted only the two lockfile-resolved `esbuild` postinstall versions required by Vitest and tsx; `npm install-scripts ls` reports no unreviewed install scripts.
- Added independent `api-contracts`, `shared-types`, and `fortune-content` packages with builds and smoke tests.
- Added explicit Phase 1 content and card-asset validators. An empty scaffold is accepted now, but both commands state that this is not the Phase 2 three-card completeness gate.
- Declared the content validator's Node runtime types explicitly after the first typed-lint pass exposed its missing environment boundary.
- Added the root `check` command and a least-privilege GitHub Actions workflow using Node from `.nvmrc` and install-from-lockfile semantics.
- Added repository prerequisites, workspace layout, and check commands to the README.

Verification required before commit:

```text
corepack npm ci
corepack npm run check
git diff --check
```

Deployment impact: no service is deployable yet. CI becomes active when this commit reaches GitHub; it performs read-only checkout and repository quality gates with no deployment credentials.

### 2026-08-05 — Phase 1 API workspace scaffold

- Added the `@fortuneness/api` workspace with strict Node-oriented TypeScript, isolated build output, and a smoke test for the canonical `/health` and `/v1` path reservations.
- Added the prescribed API source-boundary documentation for database, middleware, routes, services, and utilities.
- Added `apps/api/.env.example` with placeholders for the configuration contract in specification section 14. Values are development-only examples; all auth and encryption values are visibly non-secret placeholders.
- Deliberately deferred Express, Prisma, real health readiness, Railway configuration, and deployment commands to their chronological Phase 3/4 owners.

Verification required before commit:

```text
corepack npm ci
corepack npm run check
git diff --check
```

Deployment impact: the API workspace compiles but has no process entry point and must not be deployed. No environment or database was changed.

### 2026-08-05 — Phase 1 Expo iPhone/iPad workspace

- Locked Expo SDK `57.0.10`, React Native `0.86.2`, and React `19.2.3` from the current stable Expo template compatibility set.
- Added the Expo Router app with one root stack, a safe-area/scrolling launch scaffold, dark celestial baseline colors, and an iPhone/iPad-compatible adaptive content width.
- Configured iOS-only output, `supportsTablet: true`, all orientations, Split View-compatible `requireFullScreen: false`, custom URL scheme, dark splash background, and the Expo SDK 57 minimum iOS deployment target of 16.4.
- Added development-build dependencies plus Secure Store, SQLite, localization, notifications, TanStack Query, Zustand, Reanimated, gesture handling, and safe-area/screen primitives.
- Overrode only `xcode`'s transitive `uuid` to patched `11.1.1`, matching the proven reference repository, after npm audit identified the older UUID buffer-bounds advisory in Expo's native project tooling.
- Added development, preview, and production EAS profiles with explicit environment separation. Production refuses to resolve without an owner-confirmed `APP_BUNDLE_ID`; non-production defaults are isolated placeholders.
- Declared English in every build and the length-expanded `en-XA` pseudo-locale only in development/preview. Production declares English only and embeds `EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE=false`.
- Added documented local-module boundaries for Game Center and StoreKit 2 without fabricating unverified Swift code or entitlement evidence before the Phase 0 Mac/device spike.
- Added mobile config, unit-test, typecheck, and iOS export gates to the root checks.
- Kept dynamic build-profile helpers self-contained in `app.config.ts` because Expo's config loader transpiles that root file but not imported TypeScript modules; unit tests import the same helpers directly.
- Used TypeScript 6 path mapping without the deprecated `baseUrl` option after the first mobile typecheck surfaced its TypeScript 7 removal warning as an error.
- Pinned hoisted `react`/`react-dom` to Expo's `19.2.3` compatibility version and updated `@types/react` to Expo Doctor's expected `19.2.4`, preventing duplicate native React installations in the monorepo.
- Inspected Expo's native config, confirmed all four iPhone/iPad orientations and Split View support, and removed the explicit notifications config plugin because it added an unused Apple push entitlement; the autolinked notifications module remains available for V1 local reminders.
- Added Expo System UI at the SDK-compatible version and let Expo own the dark interface-style plist entry instead of duplicating it manually.
- Added a final local-notifications-only config plugin through Expo's supported `expo/config-plugins` sub-export because the bundled notifications integration still injects `aps-environment`; native introspection must prove that only this unused push entitlement is removed while the local notification module remains linked.
- Scoped the CommonJS `require()` lint exception to the Expo config-plugin directory only; application and service code retain the strict import rule.

Verification:

```text
corepack npm ci
corepack npm install-scripts ls
corepack npm audit
corepack npm run check
cd apps/mobile
corepack npm exec expo-doctor@latest
corepack npm exec expo -- config --type introspect --json
cd ../..
git diff --check
```

Result: clean install audited 735 packages with 0 vulnerabilities and no unreviewed install scripts; all formatting/lint/config/type/build gates and 10 tests passed; Expo Doctor passed 20/20 checks; Metro exported the 1,549-module iOS bundle; introspection confirmed four orientations on iPhone and iPad, `UIRequiresFullScreen=false`, deployment target 16.4, and no `aps-environment` entitlement.

Deployment impact: no EAS project, credentials, remote bundle ID, or API URL was created. The JavaScript iOS bundle can be exported locally, but a signed development IPA and on-device acceptance remain open Phase 0/1 evidence.

### 2026-08-05 — Phase 0 trust-boundary and abuse review

- Added the versioned identity/commerce threat model covering protected assets, seven trust boundaries, global invariants, and 20 abuse/failure cases.
- Assigned every critical/high control to an implementation phase and named the evidence required to keep the design finding closed.
- Recorded that no critical/high design gap remains, while every implementation proof remains open and the physical Game Center/StoreKit/reviewer-access gates still block their owning phases.
- Added explicit review triggers for identity, commerce, allowance, privacy/deletion, platform, and lock/idempotency policy changes.

Verification:

```text
corepack npm run format:check
git diff --check
```

Deployment impact: documentation only. No external account, credential, environment, service, database, or mobile binary changed.

### 2026-08-05 — Phase 2 adaptive coded fixture slice

- Replaced the temporary launch panel with one-root Expo Router fixtures for Oracle, Reveal, Collection, Shop, and Settings.
- Added shared colors, spacing, radii, typography, 600/900-point window classes, responsive gutters, capped Oracle card sizing, safe-area scrolling shells, surfaces, buttons, banners, and headers.
- Added an accessible, code-rendered 2:3 tarot card with a rotation-symmetric celestial back, face labels/symbols/orientation, illustration layer boundary, focus state, and compact collection mode.
- Added an accessible four-choice intention radio group, adaptive Oracle composition, Deck/Readings collection modes, plain-language StoreKit placeholders without hardcoded prices, and settings/reminder/legal fixtures.
- Applied the debug-only length-expanded pseudo-localizer through the shared text component so fixture copy can be stress-tested without exposing the pseudo-locale in production.
- Added pure breakpoint/card-sizing tests and the three-card metadata fixture used by the visual slice. Google ADC illustration layers and the complete 24-reading slice remain separate gates.

Verification required before commit:

```text
corepack npm ci
corepack npm run check
cd apps/mobile
corepack npm exec expo-doctor@latest
cd ../..
git diff --check
```

Deployment impact: no deployment or native credential change. The exported JavaScript fixture is development-only and does not connect authentication, draws, purchases, notifications, or deletion.
