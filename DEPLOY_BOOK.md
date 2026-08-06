# Fortuneness Deploy Book

Last updated: 2026-08-06

This is the chronological build, verification, and deployment record for Fortuneness. It is maintained in the same commit as every logical implementation change. Entries are append-only apart from correcting inaccurate instructions, and secrets must never be recorded here.

The canonical product and technical requirements live in [`FORTUNENESS_SPEC.md`](./FORTUNENESS_SPEC.md). This book records how those requirements are being delivered; it does not replace them.

## Current delivery state

| Phase                                             | State                             | Current gate                                                                                                                         |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 0 — owner accounts, naming, and risk spikes | Blocked on owner/external actions | Apple, Expo/EAS, Railway, Google ADC, editorial ownership, and reviewer-access decisions remain open.                                |
| Phase 1 — repository and quality scaffold         | In progress                       | JavaScript/API/mobile scaffold is present; native modules, entitlement evidence, EAS linkage, and signed device builds remain gated. |
| Phase 2 — design system and adaptive slice        | In progress                       | Static fixtures and 24 templates exist; human editorial/art approval and the Expo device matrix remain open.                         |
| Phase 3 — API skeleton and shared contracts       | Local implementation complete     | Full local gate passes; Railway staging linkage, variables, PostgreSQL, deploy, and live health evidence remain external.            |
| Phases 4–10                                       | Not started                       | Must follow the acceptance order in the specification.                                                                               |
| Phase 11 — full deck and content                  | In progress                       | All 78 crops validate; human art/alt-text review, bundle integration, 624 approved templates, and device/performance gates remain.   |
| Phases 12–17                                      | Not started                       | Must follow the acceptance order in the specification.                                                                               |

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

### 2026-08-05 — Phase 2 three-card editorial development slice

- Replaced the empty content scaffold with typed card metadata for The Fool, Queen of Cups, and Three of Wands: one Major Arcana, one court card, and one pip card.
- Authored the complete 24-entry English matrix across upright/reversed orientations and General, Love, Work, and Growth intentions.
- Added three English illustration descriptions and visible-imagery alternative texts. All content is marked `READY_FOR_REVIEW`; no AI-authored copy is represented as human-approved.
- Expanded validation to enforce card references, unique logical keys/assets/copy, all active matrix combinations, supported locales, 50–100-word messages, 10–25-word actions, 8–25-word alternative text, and prohibited absolute, harmful, medical, financial, unsafe, or punitive phrasing.
- Added tests for the complete matrix, role coverage, length bounds, missing combinations, prohibited phrasing, and incomplete alternative text.

Verification required before commit:

```text
corepack npm run check
git diff --check
```

Deployment impact: content and validation only. The dataset is not seeded or served by the API, and human editorial approval remains a Phase 2 acceptance blocker.

### 2026-08-05 — Phase 2 Google ADC art proof 1 of 3

- Verified Application Default Credentials and the configured Vertex project without printing tokens or secret values.
- Used the authorized single Google Vertex ADC request to generate The Fool illustration with `gemini-3.1-flash-image` and the draft `phase2-nocturnal-celestial-v1` prompt direction.
- Visually inspected the result: the central traveler/dog silhouette, celestial palette, crop safety, and lack of text/watermark are suitable for coded-frame testing. Human editorial and real-device visual review remain open.
- Recorded the 848 × 1264 RGB source, 2,022,576-byte size, exact output path, provider/model, review state, English alternative text, and SHA-256 checksum in the asset manifest.
- Integrated the single-source proof through the code-rendered card face in Reveal and Collection; no CDN or duplicate tracked shipping binary is used.
- Expanded asset validation to verify PNG structure, dimensions, aspect tolerance, file size, checksum, unique keys/checksums, manifest coverage, alternative-text length, and review status.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: one local bundled development art proof was added. No production deployment, remote service configuration, or credential changed; two additional ADC proofs, normalization lock, and device approval remain open.

### 2026-08-05 — Phase 2 motion and resilient-state prototypes

- Added a Reanimated card reveal sequence that waits for the fixture reading, uses a 675 ms perspective flip by default, then exposes the complete reading in accessible order.
- Added the system Reduce Motion path: a 200 ms crossfade, no 3D/parallax transform, no content delay, and immediate accessibility availability.
- Added pure motion-profile tests that enforce the specification’s 600–750 ms default and 150–250 ms reduced-motion windows.
- Added an adaptive purchase-information sheet with a compact full-screen fallback and a centered regular-width presentation.
- Added a non-interrupting Oracle loading skeleton whose pulse stops under Reduce Motion, plus an assertive but recoverable error state that states no allowance was consumed.
- Added development-only Oracle controls for exercising ready, loading, and error fixtures without exposing a production debug control.

Verification required before commit:

```text
corepack npm run check
cd apps/mobile
corepack npm exec expo-doctor@latest
cd ../..
git diff --check
```

Deployment impact: UI prototypes only. No API call, persistence, allowance mutation, purchase initiation, notification, or production configuration was added.

### 2026-08-05 — Phase 2 acceptance evidence matrix

- Added `docs/phase2-visual-acceptance-matrix.md` to separate passing local automation from evidence that requires a signed iOS development build, Mac/Xcode, physical iPhone/iPad testing, and named human review.
- Defined compact/large iPhone, iPad portrait/landscape, Split View, Stage Manager, 320-point, pseudo-locale, Dynamic Type, VoiceOver, Reduce Motion, Reduce Transparency, focus, and contrast rows.
- Recorded honest art/editorial states: The Fool is generated and unreviewed, two illustrations are not generated, 24 templates and three descriptions are ready for review, and the draft art style remains unlocked.
- Added a reusable evidence template with build/device/OS/viewport/accessibility/tester/screenshot/retest fields and explicit Phase 2 exit conditions.

Verification required before commit:

```text
corepack npm run format:check
git diff --check
```

Deployment impact: documentation only. No build, service, credential, device, content approval, or production state changed.

### 2026-08-05 — Phase 2 Google ADC art proofs 2 and 3

- Generated Queen of Cups and Three of Wands through the authorized Google Vertex ADC pipeline with `gemini-3.1-flash-image` and the shared draft nocturnal/celestial prompt direction.
- Visually inspected both sources. Queen of Cups has a dignified central figure, readable cup, moonlit water, lilies, and no text/watermark. Three of Wands has a clear traveler, exactly three flowering staffs, distant ships, and no text/watermark.
- Registered both 848 × 1264 RGB sources with exact byte sizes, provider/model, output paths, English alternative text, review notes, and SHA-256 checksums.
- Integrated both sources into the code-rendered Collection card faces, completing the three-card locally bundled proof set without CDN dependencies or duplicate shipping binaries.
- Updated the Phase 2 evidence matrix from 1/3 to 3/3 generated proofs while preserving `GENERATED_UNREVIEWED`/`READY FOR REVIEW` states and the unlocked prompt-style gate.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run check
cd apps/mobile
corepack npm exec expo-doctor@latest
cd ../..
git diff --check
```

Deployment impact: two locally bundled development art proofs were added. No production deployment, remote configuration, credential, human approval, or final normalization state changed.

### 2026-08-05 — Fortuneness brand-mark and app-icon proof

- Generated one text-free 1024 × 1024 RGB Fortuneness brand mark through Google Vertex ADC using a dedicated draft prompt version.
- Visually inspected the crescent, eight-point dawn star, botanical symmetry, safe margins, small-size silhouette, and lack of text/watermark/transparency.
- Added a separate brand manifest with provider/model, intended app-icon and splash roles, exact output path, byte size, SHA-256 checksum, and `GENERATED_UNREVIEWED` status.
- Added brand validation for PNG structure, square dimensions, minimum size, RGB/no-alpha encoding, file size, checksum, unique keys/roles, supported roles, and manifest coverage.
- Configured the development Expo app to use the single tracked source for its app icon and contained launch mark against the midnight background.
- Added `brand:validate` to the root quality gate and recorded the remaining masked-icon, launch-screen, and physical-device review in the Phase 2 matrix.

Verification required before commit:

```text
corepack npm run brand:validate
corepack npm run check
cd apps/mobile
corepack npm exec expo-doctor@latest
cd ../..
git diff --check
```

Deployment impact: one locally bundled, unreviewed development brand proof and native asset configuration were added. A new native build is required to see the icon/splash; no signed build, store record, credential, human approval, or production deployment changed.

### 2026-08-05 — Phase 2 prompt provenance and review rubrics

- Added immutable JSON prompt catalogs containing the exact text used for all three tarot proofs and the brand-mark proof.
- Added prompt source paths, stable prompt keys, and SHA-256 prompt-text checksums to the corresponding manifests.
- Extended both validators to enforce prompt catalog schema/version alignment, repository-scoped source paths, referenced prompt completeness, unique references, exact prompt checksums, and absence of unreferenced prompt entries.
- Added a human editorial/safety rubric covering card/orientation/intention fit, possibility language, consequential-decision safety, interpersonal boundaries, emotional safety, copy structure, distinctness, English quality, alt text, and approval evidence.
- Added the unlocked Phase 2 art-direction draft covering palette, line language, controlled variation, composition targets, proof-specific device questions, rejection conditions, and the style-lock record.
- Linked the rubrics from the Phase 2 acceptance matrix. Passing automation remains insufficient for `APPROVED` status.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run brand:validate
corepack npm run check
git diff --check
```

Deployment impact: validation and documentation only. No image was regenerated, no review status was promoted, and no deployment, credential, build, or production state changed.

### 2026-08-05 — Phase 2 development art-review gallery

- Added a development-only Art Review route reachable from development Settings and redirected away in production builds.
- Displays the brand-mark candidate at 32, 60, and 120-point review sizes with an explicit warning that rounded previews do not replace Apple’s real icon masks.
- Displays every proof in the actual code-rendered frame as full upright and compact reversed cards, with card key, generated/unreviewed state, and alternative text alongside the crop.
- Added reviewer prompts for subject legibility, reversal behavior, frame competition, alt-text accuracy, contrast, representation, visual density, and safe margins.
- Added pure review-width rules and tests proving two compact cards fit a 320-point viewport and regular review sizes cap at 148/340 points.
- Updated the Phase 2 evidence matrix to include the gallery and the increased automated-test count. The gallery prepares device review but does not record or imply approval.

Verification required before commit:

```text
corepack npm run check
cd apps/mobile
corepack npm exec expo-doctor@latest
cd ../..
git diff --check
```

Deployment impact: development UI and tests only. No production navigation, asset status, approval, server interaction, credential, native capability, or deployed state changed.

### 2026-08-05 — Phase 2 canonical editorial review report

- Added a deterministic Markdown editorial report generated directly from the validated canonical content manifest, avoiding a second hand-maintained copy of the 24 templates.
- Groups cards by canonical sort order and templates by upright/reversed, General/Love/Work/Growth, and variant.
- Prints stable `cardKey:orientation:intention:variant` review keys, statuses, headlines, messages/actions with word counts, affirmations, card alt text, illustration descriptions, and blank reviewer decision/notes fields.
- Added `corepack npm run content:review` for reviewers and tests proving all 24 logical keys appear exactly once, output is deterministic, and card sections respect canonical order.
- Linked the report workflow from the editorial rubric and updated the Phase 2 evidence matrix/test count. Generated output still records no approval by itself.

Verification required before commit:

```text
corepack npm run content:review
corepack npm run check
git diff --check
```

Deployment impact: content review tooling, tests, and documentation only. Canonical fortune copy, review status, API behavior, mobile runtime behavior, credentials, and deployment state did not change.

### 2026-08-05 — Phase 2 runtime pseudo-locale QA control

- Added app-level QA locale state so a development or preview build can switch direct and composite visible `AppText` copy between English and the length-expanded `en-XA` pseudo-locale during one review session.
- Added a Settings switch only when `EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE=true`; the production profile keeps the control unavailable and always resolves to English.
- Preserved `EXPO_PUBLIC_LOCALE_OVERRIDE=en-XA` as an optional initial state while allowing the reviewer to return to English without rebuilding.
- Corrected explicit pseudo-localization in the legacy copy helper and added unit coverage for build-profile gating, override resolution, unchanged English, and expanded/wrapped output.
- Updated the mobile README and Phase 2 evidence matrix so device testers use the runtime control for the required two-locale pass.

Verification required before commit:

```text
corepack npm run test --workspace @fortuneness/mobile
corepack npm run check
git diff --check
```

Deployment impact: development/preview QA behavior and documentation only. Production hard-disables pseudo-localization; no content approval, art status, API behavior, credential, native capability, or deployed state changed.

### 2026-08-05 — Phase 2 celestial page backdrop

- Added a restrained code-native celestial background to the shared safe-area page shell: two mist fields, fine orbital lines, and 12 deterministic star particles behind scrollable content.
- Capped the particle field in a pure layout module and kept one native-driven field animation instead of independent per-star animation.
- Pauses the Reanimated field whenever the app is inactive and cancels it on unmount; Reduce Motion removes travel/repetition and uses a static opacity.
- Observes the iOS Reduce Transparency setting and removes the decorative field entirely, leaving the existing opaque page and surface colors.
- Hides the whole backdrop from accessibility and pointer handling so it cannot disrupt VoiceOver order or interactions.
- Added tests for the particle cap/bounds and the Reduce Motion profile, and updated the Phase 2 evidence matrix/test count.

Verification required before commit:

```text
corepack npm run test --workspace @fortuneness/mobile
corepack npm run check
git diff --check
```

Deployment impact: shared mobile presentation and tests only. No content/art approval, API behavior, stored data, credential, native entitlement, or deployed state changed.

### 2026-08-05 — Phase 2 shared motion preference

- Replaced the inert Settings-only `Reduce more motion` fixture value with app-level session state shared by every current animated surface.
- Resolves the effective motion policy as iOS Reduce Motion OR the Fortuneness preference, so the app can only reduce further and can never override an enabled system accessibility setting.
- Applied the policy to route transitions, the reveal flip/crossfade, loading-skeleton pulse, adaptive-sheet transition, and celestial-backdrop drift.
- Updated the Settings description to state its Phase 2 session scope; persistence remains deferred to the Settings implementation phase.
- Added truth-table tests for system and in-app precedence and updated the Phase 2 evidence matrix/test count.

Verification required before commit:

```text
corepack npm run test --workspace @fortuneness/mobile
corepack npm run check
git diff --check
```

Deployment impact: mobile fixture motion behavior and tests only. No persisted preference, content/art approval, API behavior, stored account data, credential, native entitlement, or deployed state changed.

### 2026-08-05 — Full-deck unreviewed generation catalog and provenance tooling

- Product owner explicitly authorized generating all remaining card illustrations before Expo device review; the art-direction draft now records this override to the earlier operational hold, but it does not constitute art, accessibility, or editorial approval.
- Added a canonical 78-card generation catalog covering all Major Arcana and every Wands, Cups, Swords, and Pentacles rank with a stable asset key, card-specific visible scene, and draft 8–25-word English alt text.
- Added a consistent full-deck prompt builder that preserves the exact three Phase 2 proof prompts and produces one exact, checksum-bound prompt for every remaining card.
- Added `corepack npm run asset:prompts` to materialize the complete prompt catalog and `corepack npm run asset:sync` to atomically rebuild source metadata/checksums from generated PNGs without promoting review status.
- Generation will proceed in logical batches. Each batch remains `GENERATED_UNREVIEWED` until inspected in source/contact sheets and later accepted in coded frames on physical devices.

Verification required before commit:

```text
corepack npm run asset:prompts
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: asset-production catalog, provenance tooling, and documentation only. No new image is created by this commit, and no review status, production bundle, API, credential, or deployed state changes.

### 2026-08-05 — Full-deck Major Arcana generation checkpoint 1

- Generated five new Major Arcana sources through Google Vertex ADC: The Magician, The High Priestess, The Empress, The Emperor, and The Hierophant.
- All five are 848 × 1264 RGB PNGs below the 4 MB source limit, have unique SHA-256 checksums, and are bound to their exact prompts in the 78-card manifest.
- Inspected every source at high detail. All have readable central subjects and no visible words, signatures, or watermarks.
- Each source includes a prominent generated ornamental border despite the prompt exclusion. This is recorded per card as an open coded-frame issue; no asset was promoted beyond `GENERATED_UNREVIEWED`.
- The Empress crown does not expose a confidently countable twelve-star set at inspection size, so its note also flags that symbolic-count question for review.
- The sixth request, The Lovers, returned Google `429 RESOURCE_EXHAUSTED`; no output was written, the batch stopped immediately, and no automatic retry or alternate model request was made.
- After synchronization, the full-deck manifest validates at 8/78 generated sources (the original three proofs plus five new cards).

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: five unreviewed source illustrations, their draft accessibility/provenance metadata, and documentation only. The mobile bundle still imports only the three Phase 2 proofs; no review status, API, credential, entitlement, or deployed state changed.

### 2026-08-05 — Full-deck Major Arcana source completion

- Generated and individually inspected the remaining sixteen Major Arcana sources, from The Lovers through The World, through Google Vertex ADC one request at a time.
- The Major Arcana source set is now complete at 22/22; with the two existing Minor Arcana proofs, the full-deck manifest validates at 24/78 generated sources.
- Every new source is an 848 × 1264 RGB PNG below the 4 MB source limit, has a unique SHA-256 checksum, and is bound to its exact prompt checksum in the canonical manifest.
- Source inspection confirmed the requested central subject and key symbolic composition for each card and found no visible words, signatures, or watermarks. Per-card observations remain recorded in `tools/card-assets/manifest.json` without promoting any source beyond `GENERATED_UNREVIEWED`.
- The Wheel of Fortune includes small zodiac-like glyphs that require later no-letter review; The Chariot uses winged dark and pale cats rather than classical sphinxes; several sources include ornamental framing that still needs coded-frame and device review.
- Google quota responses occurred while generating The Lovers, The Devil, and The World. Each request was handled serially after a cooldown, produced exactly one accepted output, and did not trigger parallel or alternate-model generation.

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: sixteen unreviewed Major Arcana source illustrations, their accessibility/provenance metadata, and documentation only. The mobile bundle still imports only the three Phase 2 proofs; no review status, API, credential, entitlement, or deployed state changed.

### 2026-08-05 — Full-deck Wands source completion

- Generated and individually inspected the thirteen missing Wands sources through Google Vertex ADC one request at a time; the previously generated Three of Wands proof remains unchanged.
- The Wands source set is now complete at 14/14, bringing the canonical full-deck manifest to 37/78 generated sources.
- Every new source is an 848 × 1264 RGB PNG below the 4 MB source limit, has a unique SHA-256 checksum, and is bound to its exact prompt checksum in the canonical manifest.
- Source inspection confirmed the requested primary symbolism and found no visible words, signatures, or watermarks. Exact staff counts were checked for the numbered cards and recorded in per-card review notes.
- Five of Wands shows four adults rather than the requested five while retaining five flowering staffs and a safe, friendly tone; Ten of Wands has a dense ten-staff bundle that needs a device-scale recount. Both remain explicitly `GENERATED_UNREVIEWED` for human source review.
- Generated ornamental edges range from light celestial arches to strong full frames and remain open coded-frame/device-review issues; no source was promoted or added to the runtime bundle.

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: thirteen unreviewed Wands source illustrations, their accessibility/provenance metadata, and documentation only. The mobile bundle still imports only the three Phase 2 proofs; no review status, API, credential, entitlement, or deployed state changed.

### 2026-08-05 — Full-deck Cups source completion

- Generated and individually inspected the thirteen missing Cups sources through Google Vertex ADC one request at a time; the previously generated Queen of Cups proof remains unchanged.
- The Cups source set is now complete at 14/14, bringing the canonical full-deck manifest to 50/78 generated sources.
- Every new source is an 848 × 1264 RGB PNG below the 4 MB source limit, has a unique SHA-256 checksum, and is bound to its exact prompt checksum in the canonical manifest.
- Source inspection found no visible words, signatures, watermarks, horror, unsafe motion, or sexual content and recorded every generated composition in per-card review notes.
- Four exact-count deviations remain open for source review: Ace of Cups has three rather than five streams; Four of Cups has five rather than four total cups; Eight of Cups has seven rather than eight cups; and Ten of Cups has nine rather than ten cups.
- Eight of Cups received one Google quota response; after a serial 60-second cooldown, the single-card retry produced one accepted output. No parallel or alternate-model generation occurred.
- Generated ornamental edges range from open scenes to strong full frames and remain coded-frame/device-review issues; no source was promoted or added to the runtime bundle.

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: thirteen unreviewed Cups source illustrations, their accessibility/provenance metadata, and documentation only. The mobile bundle still imports only the three Phase 2 proofs; no review status, API, credential, entitlement, or deployed state changed.

### 2026-08-05 — Full-deck Swords source completion

- Generated and individually inspected all fourteen Swords sources through Google Vertex ADC one request at a time.
- The Swords source set is complete at 14/14, bringing the canonical full-deck manifest to 64/78 generated sources.
- Every source is an 848 × 1264 RGB PNG below the 4 MB source limit, has a unique SHA-256 checksum, and is bound to its exact prompt checksum in the canonical manifest.
- Source inspection found no visible words, signatures, watermarks, bodies, blood, graphic injury, combat, or horror; sensitive cards use explicitly symbolic or restorative compositions.
- Four exact-count deviations remain open: Four of Swords shows five rather than four swords; Five of Swords shows four rather than five swords and four rather than two distant silhouettes; Six of Swords shows five rather than six swords; and Ten of Swords shows eight rather than ten swords.
- Ace of Swords places its olive/palm foliage around the hilt rather than crowning the blade tip, and Seven of Swords leaves the carried blades visibly unsheathed. These deviations remain recorded without promoting either source.
- Generated edges range from open compositions to elaborate full frames and remain coded-frame/device-review issues; no source was added to the runtime bundle.

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: fourteen unreviewed Swords source illustrations, their accessibility/provenance metadata, and documentation only. The mobile bundle still imports only the three Phase 2 proofs; no review status, API, credential, entitlement, or deployed state changed.

### 2026-08-05 — Full-deck Pentacles source completion

- Generated and individually inspected all fourteen Pentacles sources through Google Vertex ADC one request at a time.
- The Pentacles source set is complete at 14/14, bringing the canonical full-deck source manifest to 78/78 generated illustrations.
- Every source is an 848 × 1264 RGB PNG below the 4 MB source limit, has a unique SHA-256 checksum, and is bound to its exact prompt checksum in the canonical manifest.
- Source inspection found no readable words, signatures, watermarks, unsafe animal handling, degrading hardship imagery, or unsafe action; people are clothed, dignified, and represented across ages and skin tones.
- Three exact-count deviations remain open: Seven of Pentacles shows nine rather than seven disks; Nine of Pentacles shows ten rather than nine disks; and Ten of Pentacles shows eleven rather than ten disks.
- King of Pentacles includes small pseudo-glyphs around its disk that require review against the no-letters rule. All count/glyph observations remain recorded without promoting any source.
- Generated edges range from open compositions to strong full frames and remain coded-frame/device-review issues; no new source was added to the runtime bundle.

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: fourteen unreviewed Pentacles source illustrations, their accessibility/provenance metadata, and documentation only. The source catalog is complete, but the mobile bundle still imports only the three Phase 2 proofs; no review status, API, credential, entitlement, or deployed state changed.

### 2026-08-05 — Full 78-card source archive validation

- Recorded the completed 78/78 source archive in the Phase 2 art-direction draft while preserving the unlocked style decision and every asset's `GENERATED_UNREVIEWED` status.
- Updated card-asset validator success output to distinguish a complete source archive from partial generation; a 78/78 run now reports `full deck complete` instead of the stale `remaining prompts are planned` message.
- The validator continues to enforce canonical order, exact prompt checksums, unique image checksums, 2:3 source ratio, RGB PNG encoding, the 4 MB source limit, alt-text word bounds, manifest coverage for every source PNG, and valid review states.
- Completion is production readiness evidence only for source generation/provenance. Human source selection, accessibility, coded-frame, device, editorial, and style-lock decisions remain explicitly open.

Verification required before commit:

```text
corepack npm run asset:prompts
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
```

Deployment impact: validation messaging and documentation only. No source image, prompt, checksum, review status, mobile bundle import, API, credential, entitlement, or deployed state changed.

### 2026-08-06 — Deterministic card-crop normalization tooling

- Confirmed the repository began this pass with no modified, staged, or untracked files; `main` being ahead of `origin/main` is commit divergence, not a dirty worktree.
- Added a canonical 78-card crop plan recording one visual edge decision per source: no exterior gutter, light/white gutter, dark gutter, or the mixed King of Pentacles artifact.
- Added a sequential Pillow normalizer that preserves all archival source files and checksums, crops only the reviewed exterior canvas, removes inherited image metadata, and writes exact 1024 × 1536 RGB PNG bundle candidates.
- Ignored local Python bytecode caches so running the normalizer cannot leave false-positive worktree dirt.
- Extended manifest sync to preserve normalization records only while their source checksum remains unchanged; a changed archival source automatically invalidates its derived bundle candidate.
- Extended asset validation to bind crop plan, source checksum, crop rectangle, normalized checksum, exact 2:3 dimensions, RGB encoding, 4 MB limit, edge-band audit, canonical path, and bundle selection.
- Documented the source/normalized boundary for Expo device review. This mechanical crop pass does not promote any card beyond `GENERATED_UNREVIEWED` or approve internal generated ornamentation.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run asset:validate
git diff --check
```

Deployment impact: reproducible local normalization tooling and review metadata only. This commit creates no normalized PNG yet and changes no runtime import, human approval, API, credential, entitlement, or deployed state.

### 2026-08-06 — Major Arcana crop normalization

- Normalized all 22 Major Arcana sources sequentially to exact 1024 × 1536 RGB PNGs while leaving the 848 × 1264 archival sources and their checksums unchanged.
- Reviewed the complete normalized Major Arcana contact sheet and the per-side light/dark edge-band report.
- Tightened six initially detected 1–4 px residual frame gutters before the final render: Emperor, Hierophant, Hanged Man, Death, Temperance, and World.
- The remaining dark top-band detections on Hermit and Judgement are intentional painted sky/negative space with illustration content crossing other edges, not exterior canvas gutters.
- All 22 normalized files are uniquely checksum-bound to their source and crop record, use the canonical normalized path, and remain below the 4 MB normalized limit.
- Review status remains `GENERATED_UNREVIEWED`; this crop pass is not human art, accessibility, editorial, coded-frame, or device approval.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run format:check
git diff --check
```

Deployment impact: 22 local Major Arcana bundle candidates and manifest metadata only. No source checksum, runtime import, API, credential, entitlement, human approval, or deployed state changed.

### 2026-08-06 — Wands crop normalization

- Normalized all 14 Wands sources sequentially to exact 1024 × 1536 RGB PNG bundle candidates without modifying archival sources.
- Reviewed every Wands card together in the normalized contact sheet and checked all four sides for light and dark bands.
- Removed residual 1–7 px exterior bands from Ace, Four, Seven, Nine, Ten, Knight, and Queen after the first mechanical pass.
- Three of Wands retains an open dark sky at the top because it is painted scene content, not a canvas gutter; Queen's remaining dark top pixels are the ornamental frame outline exposed after its white gutter was removed.
- All 14 normalized Wands files validate below 4 MB with unique checksums and source-bound crop records; card review status remains `GENERATED_UNREVIEWED`.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run format:check
git diff --check
```

Deployment impact: 14 local Wands bundle candidates and manifest metadata only. No source checksum, runtime import, API, credential, entitlement, human approval, or deployed state changed.

### 2026-08-06 — Cups crop normalization

- Normalized all 14 Cups sources sequentially to exact 1024 × 1536 RGB PNG bundle candidates while preserving the archival source set.
- Reviewed every normalized Cups card in one labeled contact sheet and checked per-side edge-band depths.
- Removed residual 2–13 px dark frame gutters from Three, Five, Seven, Ten, Page, and King after the initial render.
- Six of Cups retains its painted night-sky top because flowers and architecture cross the canvas and the area is scene content rather than an exterior gutter.
- All 14 normalized Cups files validate below 4 MB with unique checksums, canonical paths, and source-bound crop records; no card was promoted beyond `GENERATED_UNREVIEWED`.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run format:check
git diff --check
```

Deployment impact: 14 local Cups bundle candidates and manifest metadata only. No source checksum, runtime import, API, credential, entitlement, human approval, or deployed state changed.

### 2026-08-06 — Swords crop normalization

- Normalized all 14 Swords sources sequentially to exact 1024 × 1536 RGB PNG bundle candidates without modifying archival images.
- Reviewed every normalized Swords card in the labeled contact sheet and inspected all edge-band detections at source/full resolution where classification was ambiguous.
- Removed residual 1–10 px exterior frame bands from Ace, Three, Four, Seven, Eight, Nine, and King after the initial pass.
- Ten of Swords keeps its dark lower foreground: a full-resolution review confirmed that the area contains ground shading and sword tips, so it is illustration content rather than a removable border.
- All 14 normalized Swords files validate below 4 MB with unique checksums and source-bound crop records; review status remains `GENERATED_UNREVIEWED`.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run format:check
git diff --check
```

Deployment impact: 14 local Swords bundle candidates and manifest metadata only. No source checksum, runtime import, API, credential, entitlement, human approval, or deployed state changed.

### 2026-08-06 — Pentacles crop normalization

- Normalized all 14 Pentacles sources sequentially to exact 1024 × 1536 RGB PNG bundle candidates while preserving the immutable source archive.
- Reviewed every normalized Pentacles card in the labeled contact sheet and checked all four sides with the edge-band audit.
- Removed the final 1–5 px perimeter slivers from Ace, Two, Five, Eight, Nine, Ten, Knight, and Queen after the first pass.
- King of Pentacles received a mixed-edge crop that removes both the near-black outside band and the cream lower-corner generation artifact without cutting its ornamental frame.
- The final Pentacles group has no light or dark band detections; all 14 files validate below 4 MB with unique checksums and source-bound crop records.
- The deck is now mechanically normalized at 78/78, but every card remains `GENERATED_UNREVIEWED` pending human source, coded-frame, accessibility, editorial, and Expo device review.

Verification required before commit:

```text
corepack npm run asset:validate
corepack npm run format:check
git diff --check
```

Deployment impact: 14 local Pentacles bundle candidates and manifest metadata only. No source checksum, runtime import, API, credential, entitlement, human approval, or deployed state changed.

### 2026-08-06 — Full-deck crop gate and Expo proof integration

- Completed deterministic normalization at 78/78 source-bound 1024 × 1536 RGB PNGs and preserved every immutable generation source/checksum.
- Hardened the validator so every unreviewed light or dark edge band fails CI. Six reviewed dark-edge exceptions remain explicit: Hermit top sky, Judgement top sky, Three of Wands top sky, Queen of Wands frame outline, Six of Cups top sky, and Ten of Swords lower foreground with sword tips.
- Confirmed all continuous light/white edge depths are zero across the normalized deck and every other dark edge depth is zero.
- Switched the three Phase 2 Expo review fixtures—Fool, Queen of Cups, and Three of Wands—from archival sources to their normalized bundle candidates.
- Updated the art-direction record, mobile asset guidance, and Phase 2 evidence matrix to distinguish immutable sources, normalized candidates, and still-open human/device approval.
- No card review status was promoted; internal generated ornamentation, source-selection deviations, accessibility text, and compact/regular real-device presentation remain open for the product owner's Expo review.

Verification required before commit:

```text
corepack npm run asset:sync
corepack npm run asset:validate
corepack npm run check
git diff --check
git status --short
```

Deployment impact: the development Expo proof now renders normalized art for its three fixture cards, and the full normalized deck is locally bundle-ready. No production deployment, API, credential, entitlement, source checksum, or human approval changed.

### 2026-08-06 — Phase 3 Express application boundary

- Added an Express 5 application factory that constructs a fresh, side-effect-free app without opening a network listener.
- Added a separate process-owned listener function so tests and future route composition do not import startup side effects.
- Added Supertest coverage proving factory instances are isolated and requestable in memory.
- Exactly pinned the Express, Supertest, and TypeScript declaration dependencies in the API workspace and lockfile.
- Kept environment parsing, middleware policy, routes, and deployment startup out of this boundary; they land as subsequent Phase 3 commits.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local API construction and dependency installation only. No port is opened by importing the package, no route or credential is added, and no Railway service or database is changed.

### 2026-08-06 — Phase 3 fail-closed environment parsing

- Added Zod parsing for the API runtime's Phase 3 configuration boundary: environment, port, database URL, proxy-hop count, CORS origins, and log level.
- Normalized CORS input to unique origin-only HTTP(S) values; paths, query strings, fragments, and non-HTTP schemes fail startup validation.
- Required production CORS entries to use HTTPS and required a positive explicit `TRUST_PROXY` hop count rather than silently trusting no or arbitrary proxies.
- Kept validation errors limited to variable names and requirements so malformed secret-bearing values are never echoed.
- Added focused tests for defaults, typed integer parsing, production proxy policy, malformed origins, PostgreSQL URL enforcement, and error redaction.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: startup configuration parsing only. No process entry point consumes the parser yet, no database connection is opened, and no Railway environment or secret is changed.

### 2026-08-06 — Phase 3 HTTP policy and normalized errors

- Composed the Express factory with Helmet defaults, disabled framework disclosure, an explicit CORS allowlist, a 32 KiB JSON body ceiling, and a bounded global rate-limit framework.
- Bound Express's proxy behavior to the already validated exact hop count; the app never enables broad boolean proxy trust.
- Added UUID request correlation that preserves only valid caller IDs, returns the selected ID in response headers and error envelopes, and records privacy-minimized structured completion logs.
- Added a Pino logger with service/environment fields and defensive redaction paths; request logs contain method and path but omit query strings, headers, bodies, IP addresses, and user identifiers.
- Normalized not-found, denied-origin, malformed JSON, oversized body, rate-limit, and unexpected failures without returning stack traces or internal error text.
- Added Supertest coverage for isolation, security headers, request IDs, CORS, body limits, rate limiting, and safe unexpected-error handling.
- Corrected the root ESLint ignore boundary so generated workspace `dist` trees remain outside source linting after a local build.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local HTTP policy and request/error handling only. No public route, database connection, credential, Railway configuration, or deployed service changed.

### 2026-08-06 — Phase 3 health, startup, and graceful shutdown

- Added a bounded PostgreSQL pool used by the Phase 3 runtime and a `SELECT 1` readiness probe; database connection details and failures never enter the health response.
- Added `GET /health` with explicit process/database states, HTTP 200 only when both are ready, HTTP 503 while the database is unavailable or the process is draining, and exemption from the public request-rate budget.
- Added a runtime composer and compiled process entry that consumes validated environment values, binds to Railway's injected port on all interfaces, and does not log secret-bearing startup values.
- Added idempotent graceful shutdown for `SIGTERM` and `SIGINT`: readiness fails first, the listener drains, PostgreSQL closes, and a bounded timeout force-closes remaining connections with a failed exit status.
- Added deterministic API build/start commands and Railway configuration-as-code using the current official Railpack, health-check, restart, overlap, and draining keys; the checked-in JSON passes Railway's live JSON schema. External service linkage remains an owner action.
- Added focused readiness and shutdown coverage, including safe database failure, drain state, health rate-limit exclusion, duplicate shutdown signals, and dependency cleanup.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: the API now has a production-shaped local startup and checked-in Railway service configuration, but nothing was deployed. Railway projects, PostgreSQL services, variables, proxy-hop evidence, and the custom config path remain external Phase 0/3 gates.

### 2026-08-06 — Phase 3 shared contracts and OpenAPI drift gate

- Promoted `/health`, readiness payloads, the normalized error envelope, and the specification's complete stable server error-code vocabulary into `@fortuneness/api-contracts` Zod ownership.
- Removed Phase 3's ad hoc transport error codes; denied origins, malformed JSON, and oversized JSON now use the specification's fixed `400 VALIDATION_FAILED` mapping.
- Rejected undocumented error codes and free-form `details` at the current contract boundary. Later domain phases must add code-specific strict detail schemas rather than widening this envelope.
- Made the API validate health and error response bodies against shared schemas at runtime and use the shared health path, preventing implementation and documentation from naming separate routes.
- Generated a canonical OpenAPI 3.1 document from the Zod registry and added a byte-for-byte drift check to the root quality gate.
- Updated the Railway build to compile contracts before the API so the production Node process resolves the same package tested in development.
- Added tests for schema strictness, canonical path ownership, health response coverage, OpenAPI operations/components, and complete stable-code publication.

Verification required before commit:

```text
corepack npm run openapi:generate
corepack npm run openapi:check
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api-contracts --workspace @fortuneness/api
git diff --check
```

Deployment impact: shared schemas, generated API documentation, and CI drift enforcement only. The Railway build order changes, but no service, route deployment, database schema, credential, or external environment changed.

### 2026-08-06 — Phase 3 local completion verification

- Reconciled the delivery summary with the completed local API shell and the independently progressing full-deck asset work.
- Ran the full root gate after all Phase 3 commits: formatting, lint, Expo public config, every workspace typecheck, 52 tests, OpenAPI drift, content validation, 78/78 source and normalized asset validation, brand validation, every TypeScript build, and the iOS Expo export all passed.
- Confirmed the Git worktree is clean after the chronological commit series.
- Kept Phase 3 acceptance open: no Railway project is linked, no staging variables or PostgreSQL service are available in this workspace, and no live `/health` evidence can exist until those owner-controlled resources are supplied.

Verification:

```text
corepack npm run check
git diff --check
git status --short --branch
```

Deployment impact: documentation and verification evidence only. No code, schema, asset, credential, external service, or deployed state changed.

### 2026-08-06 — Phase 4 canonical Prisma integrity model

- Continued code implementation with external Apple/EAS/Railway setup explicitly deferred by the owner; acceptance evidence remains open and is not represented as complete.
- Added Prisma ORM 7 with the PostgreSQL driver adapter, explicit generated-client commands, a Prisma 7 configuration boundary, and schema validation in the root quality gate.
- Reviewed and allowlisted only the pinned Prisma CLI/engine lifecycle scripts required for schema generation and migrations; `npm install-scripts ls` reports no unreviewed scripts.
- Defined the complete Phase 4 identity, session, idempotency, financial ownership, token binding, tarot content, allowance, draw, commerce, consent, deletion, notification, and audit model in the canonical Prisma schema.
- Generated the initial PostgreSQL migration and added constraints Prisma cannot express: nonoverlapping allowance ranges, partial uniqueness for pending reveals/current token bindings/active templates/deletion requests, quota and ledger checks, immutable ownership, append-only credit history, and irreversible zero-balance financial cutoff.
- Kept generated Prisma Client output ignored and reproducible so a clean checkout generates the exact client before typecheck/build.
- Applied the migration successfully to an isolated local PostgreSQL 17 probe database, confirmed 21 tables, 86 constraints, and 10 custom triggers, then dropped only that disposable database and verified it no longer exists.

Verification required before commit:

```text
corepack npm install-scripts ls
corepack npm run db:schema:format --workspace @fortuneness/api
corepack npm run db:schema:validate --workspace @fortuneness/api
corepack npm run prisma:generate --workspace @fortuneness/api
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
git diff --check
```

Deployment impact: checked-in PostgreSQL schema and initial migration only. No database command connected to Railway or any other database, and no migration, seed, backup, or deployed service changed.

### 2026-08-06 — Phase 4 deterministic deck and development-content seed

- Exported the versioned English card/template schemas and strengthened card validation so Major Arcana cannot carry suit/rank fields and every Minor Arcana row requires a valid suit, rank, and matching pip/court role.
- Added a canonical-deck transformer that accepts the existing 78-card art catalog and proves the exact 22 Major/56 Minor key sequence, stable 0–77 sort order, Roman/display labels, complete suit/rank matrix, English names, illustration descriptions, and bounded alternative text.
- Corrected the Queen of Cups canonical sort order from 37 to 48 before seeding against the database's unique sort-order constraint.
- Added a deterministic Prisma seed that upserts all 78 card rows, activates only the three-card development pool, and upserts its complete 24-template English intention/orientation matrix by the versioned logical key.
- Made seed typechecking and Prisma Client generation explicit so the seed runs from a clean checkout and fails safely when `DATABASE_URL` is absent.
- Removed the UTF-8 byte-order mark from the initial migration after a clean PostgreSQL 17 `migrate deploy` exposed that byte-zero portability failure.
- Migrated a new isolated PostgreSQL 17 database, ran the seed twice, confirmed one applied migration, 78 cards, 3 active cards, 24 templates, and 24 active templates after the second run, then dropped the disposable database and confirmed no seed-probe database remained.

Verification required before commit:

```text
corepack npm install-scripts ls
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/fortune-content --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/fortune-content --workspace @fortuneness/api
corepack npm run content:validate
corepack npm run db:schema:validate
git diff --check
```

Deployment impact: local content-schema, migration-byte, and deterministic seed tooling only. The proof used and removed an isolated local database; no Railway database, credential, external service, or deployed environment changed.

### 2026-08-06 — Phase 4 Prisma runtime and transaction foundation

- Replaced the health-only raw PostgreSQL access path with one process-owned Prisma Client backed by the bounded `pg` pool; readiness now probes through the same client domain services will use, and shutdown disposes it exactly once.
- Added safe mapping for Prisma and nested PostgreSQL adapter errors covering uniqueness, foreign-key, check/exclusion, not-found, unavailable, serialization, deadlock, and lock-contention outcomes without exposing database messages or constraint details to clients.
- Added the canonical `READ COMMITTED` transaction wrapper with at most five attempts and jittered exponential conflict backoff capped at 200 ms; non-conflict failures are never retried blindly.
- Added typed `FOR UPDATE` helpers that enforce the global `User → FinancialSubject` writer lock order and fail closed when a requested lock target does not exist.
- Mapped transient database exhaustion/unavailability to the stable `503 RETRYABLE_CONFLICT` envelope with `retryable` and `sameKeyRetrySafe` both true; the response omits SQL state and internal causes.
- Added unit coverage for every supported Prisma error class, nested adapter SQLSTATE mapping, retry bounds/backoff, nonretryable uniqueness, lock ordering, and safe HTTP normalization.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local API database-runtime and transaction infrastructure only. No public route, schema, migration, seed data, credential, external database, Railway service, or deployed environment changed.

### 2026-08-06 — Phase 4 isolated integrity harness and operations runbook

- Added an opt-in database test harness that requires an explicit administrative URL, generates and validates its own `fortuneness_test_*` name, creates from `template0`, removes the administrative URL before spawning child commands, migrates, seeds twice, runs integration and invariant checks, terminates only connections to that generated target, drops it, and verifies removal even when the test operation fails.
- Kept database integration tests out of the default unit-test command so ordinary checks never connect or mutate a database implicitly; `corepack npm run test:db` is the explicit owner-authorized boundary.
- Added isolated PostgreSQL tests proving duplicate user draw idempotency keys, duplicate environment-scoped Apple transactions, duplicate credit-ledger effects, and updates to append-only ledger history are rejected by committed database integrity.
- Added read-only post-migration/restore checks for completed migration history, the exact 78-card catalog, complete active English content matrices, ledger running-balance continuity/nonnegativity, and zero credit balance on closed financial subjects.
- Added the local/staging/production migration and backup/restore runbook: production permits `prisma migrate deploy` only, requires a restorable recovery point and exact staging evidence, uses forward-only correction, blocks restored traffic until completed-deletion tombstones are replayed, and records RPO/RTO/invariant evidence.
- Ran the harness against local PostgreSQL 17: the initial migration applied, both seed passes converged, all three integrity tests and five invariant groups passed, the generated database was dropped, and a server query confirmed zero `fortuneness_test_*` databases remained.

Verification required before commit:

```text
TEST_DATABASE_ADMIN_URL=<injected local admin URL> corepack npm run test:db
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local opt-in database test tooling, read-only invariant tooling, and operations documentation only. The generated local PostgreSQL database was removed; staging restore/backup verification remains an external gate and no Railway or production resource changed.

### 2026-08-06 — Phase 5 Game Center and session contracts

- Verified the current Apple GameKit identity contract before implementation: only persistent scoped IDs are usable; the non-Arcade signature bytes are `teamPlayerID` UTF-8, exact bundle ID UTF-8, timestamp as big-endian UInt64, then salt; verification uses RSASSA-PKCS1-v1_5 and treats aliases/restrictions as advisory.
- Added strict shared schemas for the Game Center proof, explicit persistent-ID signal, three current restriction flags, advisory locale/time zone, and account-scoped device metadata. The UInt64 timestamp remains a bounded decimal string so JavaScript transport cannot lose signed-byte precision.
- Kept `scopedIdsPersistent` as a domain boolean rather than schema-literal `true`, allowing the server to return the required `409 GAME_CENTER_ID_NOT_PERSISTENT` while the native client still blocks temporary identifiers locally.
- Added versioned authenticated-user, preferences, session-token, bootstrap, refresh, and `/v1/me` response schemas. The bootstrap exposes only the separate purchase-token UUID, never the internal financial-subject ID.
- Added canonical paths and generated OpenAPI 3.1 operations for Game Center authentication, keyed refresh rotation, authorized logout, and account bootstrap, including bearer security and stable error envelopes.
- Added contract tests for HTTPS proof keys, exact request strictness, persistent-ID representation, response fail-closed behavior, refresh idempotency header publication, and bearer-protected operations.

Verification required before commit:

```text
corepack npm run openapi:generate
corepack npm run openapi:check
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api-contracts --workspace @fortuneness/api
git diff --check
```

Deployment impact: shared schemas and generated API documentation only. The routes are not yet mounted, no Apple proof was fetched, no account/session row was created, and no Apple, Railway, database, credential, or deployed environment changed.

### 2026-08-06 — Phase 5 authentication keyrings and cryptographic primitives

- Activated the existing environment contract for separate Game Center identity HMAC, access-token, refresh-token HMAC, refresh-replay encryption, purchase-token HMAC, and purchase-token encryption keyrings.
- Required every ring to contain canonical base64 encodings of exactly 32 random bytes and required its configured current version to exist; invalid JSON, wrong key length, noncanonical encoding, and missing current versions fail startup without echoing secret values.
- Added explicit bundle ID, Game Center public-key host, certificate-issuer host, proof freshness/skew, JWT issuer/audience/TTL, refresh TTL, and deletion reauthentication bounds. Production still requires owner-injected values; example placeholders intentionally remain invalid secrets.
- Added current-write/dual-read HMAC helpers for pepper rotation, a 256-bit URL-safe opaque-token generator, fixed-length timing-safe comparison, and AES-256-GCM envelopes that bind encrypted values to record-specific authenticated context.
- Proved old-key ciphertext remains decryptable while its version is retained, altered record context fails authentication, current/previous HMAC candidates differ, malformed/mismatched keyrings fail safely, and deterministic test fixtures do not enter the production build.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: API startup validation and local cryptographic utilities only. No real secret was generated or stored, no route/session/account was created, and no Apple, Railway, database, credential, or deployed environment changed.

### 2026-08-06 — Phase 5 hardened Game Center proof verifier

- Added persistent replay-fingerprint storage with a unique SHA-256 key, bounded expiry, and an expiry index; the fingerprint contains only hashed signed proof material and no raw player identifier, salt, or signature.
- Implemented Apple's exact non-Arcade signed-byte construction (`teamPlayerID`, bundle ID, big-endian UInt64 timestamp, salt) and RSA-SHA256 PKCS#1 v1.5 signature verification with strict persistent-ID, exact-bundle, freshness, and future-skew checks.
- Added current-write/dual-read HMAC identity output for `teamPlayerID` pepper rotation and a separate current-version `gamePlayerID` migration digest; verified results contain only digests, proof fingerprint/expiry, and authoritative authentication time.
- Hardened public-key retrieval against SSRF: exact configurable HTTPS host allowlists, no credentials/custom port/fragment, all DNS answers required to be public, a connection pinned to a prevalidated address with the original TLS SNI/Host, no redirect following, a 3-second timeout, and a 64 KiB response cap.
- Added cache-control-aware key caching with concurrent-load deduplication and certificate-expiry capping.
- Validated the signing certificate as a current non-CA Apple RSA code-signing leaf, upgraded allowlisted AIA issuer retrieval to HTTPS, verified every issuer signature/CA/time boundary with loop/depth protection, and required termination at Node's trusted root store.
- Added negative coverage for temporary IDs, wrong bundles, stale/future timestamps, invalid signatures, unapproved hosts, private/link-local/reserved IPv4 and IPv6 targets, malformed certificates, key-fetch failure, and cache expiry/concurrency.
- Exercised the real retrieval/chain path with Apple's published `gc-prod-9.cer` at a date inside its validity window: the allowlisted Apple fetch returned 1,924 bytes and 300-second cache policy, the DigiCert chain reached a trusted root, and the eligible leaf exposed an RSA key.
- Applied both migrations and both seed passes to a generated PostgreSQL 17 database; the database integration suite and invariants passed, and the harness dropped and verified removal of its exact target.

Verification required before commit:

```text
TEST_DATABASE_ADMIN_URL=<injected local admin URL> corepack npm run test:db
corepack npm run db:schema:validate
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local proof verification, one checked-in replay table migration, and tests only. The live read-only certificate exercise did not authenticate a player; no raw proof was stored, no route was mounted, and no Apple account, Railway service, persistent database, secret, or deployed environment changed.

### 2026-08-06 — Phase 5 authoritative access sessions

- Added signed 15-minute HS256 access tokens carrying the immutable Game Center authentication time, user ID, session-family ID, user session version, issuer, audience, issued time, and expiry; every token publishes its signing-key version as `kid`.
- Resolved verification keys strictly by `kid`, restricted verification to HS256, and enforced issuer, audience, expiry, and bounded clock tolerance. Approved previous keys continue to verify during rotation and fail closed as soon as they are removed.
- Added authoritative authentication middleware that accepts one strict Bearer token form and then reloads the named session family and owning user on every request.
- Required the database family to be unrevoked and unexpired, to belong to the token subject, and to match both the user's current `sessionVersion` and the immutable `auth_time`; logout, deletion, blocking, and session supersession therefore invalidate an already-issued JWT immediately.
- Preserved deletion-state semantics with `423 ACCOUNT_DELETION_PENDING` and `410 ACCOUNT_PURGED`, kept all authentication responses non-cacheable, and exposed a typed request context for downstream transactional rechecks.
- Added coverage for valid claims, expiry, tampering, wrong audience, retained/removed signing keys, missing credentials, family revocation/expiry, session-version mismatch, deletion pending, and purge state.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local API token and middleware code plus the pinned `jose` runtime dependency only. No route was mounted, no real signing secret or session was created, and no Apple, Railway, database, credential, or deployed environment changed.

### 2026-08-06 — Phase 5 atomic Game Center login and bootstrap

- Mounted `POST /v1/auth/game-center` with strict shared-schema validation, stable safe error mapping, response-schema verification, and `Cache-Control: no-store`; malformed requests cannot reach proof verification or domain writes.
- Added one login transaction that reserves the verified proof fingerprint, resolves or creates the provider-neutral identity, creates the initial user and separate financial subject, creates or recovers the current purchase-token binding, creates a 30-day refresh family, hashes the refresh token and device ID, and signs the access token before commit.
- Kept raw Game Center identifiers and proof material outside persistence. The transaction writes only the verified versioned primary/secondary digests and bounded proof fingerprint, and never uses the advisory alias, restrictions, locale, time zone, or `gamePlayerID` as independent identity evidence.
- Added dual-read identity lookup and current-key backfill under a user row lock. Multiple supported digest rows must resolve to one user, while a cross-user match fails closed rather than merging accounts.
- Made concurrent first login converge on the unique current identity: the losing transaction rolls back all provisional user, financial, token, and replay rows, then resolves the committed winner. Reuse of the exact same proof remains rejected.
- Issued a separate random UUID purchase token, stored only its domain-separated versioned HMAC plus AES-GCM encrypted value bound to the binding ID, and returned the raw value only in the authenticated non-cacheable bootstrap.
- Enforced active-account-only normal session creation and canonical IANA time-zone validation. Blocked, deletion-pending, and purged records do not receive normal tokens.
- Added route coverage for validation and every public Game Center failure class. The disposable PostgreSQL suite proved two simultaneous first logins share one user/purchase binding but receive distinct session families, exact proof replay fails, and a previous-key identity migrates to the current digest.

Verification required before commit:

```text
TEST_DATABASE_ADMIN_URL=<injected local admin URL> corepack npm run test:db
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local API authentication service/route/runtime wiring and tests only. The database proof used a generated local database that the harness dropped and verified; no physical Game Center proof, real token/key, Railway service, persistent database, credential, or deployed environment changed.

### 2026-08-06 — Phase 5 session-version persistence and lock order

- Added the issuing user `sessionVersion` to every session-family row with a positive-value database constraint. New Game Center families persist it explicitly, and authoritative access checks now require the JWT, family, and current user versions to agree.
- Added typed `FOR UPDATE` helpers for `SessionFamily` and `RefreshToken`, plus the canonical combined `User → SessionFamily → RefreshToken` acquisition helper. The helper verifies the locked rows share the expected ownership before a session mutation may continue.
- Added unit coverage for the three-row lock sequence and for immediate access-token rejection when the family version is stale even if the current user row still matches the JWT.
- Added a forward migration that backfills the only valid initial version for pre-refresh session rows and then removes the database default so future writers must supply the authoritative value.

Verification required before commit:

```text
TEST_DATABASE_ADMIN_URL=<injected local admin URL> corepack npm run test:db
corepack npm run db:schema:validate
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: one additive/backfilled session-family column and local API lock/authentication code. The migration still requires the normal staging backup/restore and `migrate deploy` gate before production; no persistent database or deployed environment changed.

### 2026-08-06 — Phase 5 refresh rotation and logout

- Mounted strict, non-cacheable refresh and logout routes. Refresh requires and echoes a UUID `Idempotency-Key`; CORS now exposes that response header, and shared OpenAPI documents all implemented invalid-session, idempotency, deletion-pending, and purge outcomes.
- Added dual-read refresh-token lookup across retained HMAC keys, followed by the mandatory `User → SessionFamily → RefreshToken` row locks and authoritative user/family/version/expiry rechecks before any rotation.
- Made first-use rotation atomic: the presented token is consumed, one current-key hash-only replacement references it, the original immutable Game Center `auth_time` is copied into the new access token, and the family retains its fixed 30-day boundary.
- Added a dedicated AES-GCM replay receipt containing the replacement response for at most 120 seconds. Its authenticated context binds the presented token row, idempotency key, and canonical request hash; the raw replacement token appears nowhere else in persistence.
- Exact concurrent or lost-response retries return the same receipt. A different key, different canonical request, expired receipt, missing encryption key, or corrupt ciphertext commits whole-family revocation before returning an authorization/idempotency error.
- Corrected refresh idempotency scope by removing the overly broad family/key unique index: the same client UUID may be validly reused against a later presented-token digest, while each consumed token and replay receipt still carry their own key/request binding.
- Added logout as an authoritative protected transaction that reacquires `User → SessionFamily`, rechecks version, ownership, expiry, status, and immutable `auth_time`, then revokes only the current family. A repeated logout fails normal authorization.
- The disposable PostgreSQL suite proved successor-token key reuse, concurrent same-key receipt replay, malicious different-key family revocation, normal logout, repeated-logout rejection, four forward migrations, deterministic double seed, and all database invariants; its generated database was removed.

Verification required before commit:

```text
TEST_DATABASE_ADMIN_URL=<injected local admin URL> corepack npm run test:db
corepack npm run openapi:generate
corepack npm run openapi:check
corepack npm run db:schema:validate
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api-contracts --workspace @fortuneness/api
git diff --check
```

Deployment impact: one index-removal migration plus local API session services/routes, generated OpenAPI, and tests. The migration restores the specified token-scoped idempotency semantics and still requires normal staging evidence; no persistent database, key, credential, Railway service, or deployed environment changed.

### 2026-08-06 — Phase 5 authoritative account bootstrap

- Mounted bearer-protected `GET /v1/me` and exported its shared response type. The route validates the domain response, never caches it, and documents authorization, concurrent deletion, and purge outcomes.
- Reacquired locks in `User → SessionFamily → FinancialSubject` order before exposing account/bootstrap state, then rechecked ownership, active status, session/family versions, expiry, revocation, and immutable Game Center `auth_time` inside the transaction.
- Loaded only the current recoverable purchase-token binding and decrypted it with binding-ID authenticated context and an approved retained encryption key. Missing, erased, malformed, or undecryptable bindings fail closed without exposing internal cryptographic details.
- Returned canonical user preferences and the same separate purchase-token UUID established at Game Center login; the internal financial-subject ID remains server-only.
- Corrected the preexisting financial-subject lock projection to match the canonical schema: balances are derived from the append-only ledger, so the row lock no longer queries a nonexistent `creditBalance` column.
- Added route coverage for non-cacheable success and safe account-state failures. The disposable PostgreSQL flow now retrieves and compares the real encrypted bootstrap token under locks before logging out, then removes its generated database after all invariants pass.

Verification required before commit:

```text
TEST_DATABASE_ADMIN_URL=<injected local admin URL> corepack npm run test:db
corepack npm run openapi:generate
corepack npm run openapi:check
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api-contracts --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api-contracts --workspace @fortuneness/api
git diff --check
```

Deployment impact: local API account-bootstrap service/route/contracts and a corrected SQL lock projection only. No schema migration, persistent database, purchase token, key, credential, Railway service, or deployed environment changed.

### 2026-08-06 — Phase 5 native Game Center module and entitlement code

- Replaced the placeholder boundary with an iOS-only local Expo module matched to the pinned Expo 57 Modules API and automatically discovered from the app's native modules directory.
- Added one idempotent `GKLocalPlayer.authenticateHandler`, main-thread presentation of GameKit's supplied controller, authentication-change notification forwarding, and deterministic native states for not-started, authenticating, presenting, authenticated, and unavailable outcomes.
- Exposed authenticated alias, `teamPlayerID`, `gamePlayerID`, persistent-scoped-ID status, and all three current restriction flags only in process memory/events; temporary identifiers are explicitly rejected before proof retrieval.
- Added identity-verification retrieval for the exact Apple bundle URL/signature/salt/UInt64 timestamp items, encoding binary values as base64 and the timestamp as a decimal string so JavaScript cannot lose signed-byte precision.
- Added an optional TypeScript native-module wrapper that fails into an explicit unsupported development-build state in Expo Go instead of crashing, plus strongly typed state, proof, restriction, and event contracts.
- Added the Game Center config plugin and verified Expo config introspection emits `com.apple.developer.game-center = true`. Expo autolinking found `FortunenessGameCenterModule` with no duplicate module.
- Documented the remaining physical-device setup gate: App ID capability, provisioning profile, regenerated development client, signed-IPA entitlement inspection, presentation, persistent proof, restrictions, and account-switch exercises.

Verification required before commit:

```text
corepack npm exec expo-modules-autolinking -- search --platform apple
corepack npm exec expo -- config --type introspect
corepack npm run config:check --workspace @fortuneness/mobile
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/mobile
corepack npm run test --workspace @fortuneness/mobile
corepack npm run build --workspace @fortuneness/mobile
git diff --check
```

Deployment impact: local Expo/Swift module, TypeScript wrapper, and generated-entitlement configuration only. Windows cannot compile GameKit; the documented macOS/physical-device build gate remains required. No App ID, profile, IPA, Apple account, credential, Railway service, or deployed environment changed.

### 2026-08-06 — Phase 5 mobile account-session lifecycle

- Added a contract-validated mobile API client for Game Center login, refresh rotation, authoritative account bootstrap, and logout. Requests use bounded timeouts, normalized caller-safe errors, non-secret diagnostics, and fail-closed response validation.
- Added an explicit React Native export for the shared contracts package and a mobile prebuild dependency so Metro consumes compiled ESM while TypeScript and Node development continue to consume source contracts without resolution drift.
- Added fail-closed public mobile environment parsing for the API and public legal/support URLs. Preview and production URLs require HTTPS, embedded credentials and non-HTTP schemes are rejected, and unknown environment labels cannot silently weaken policy.
- Added device-only SecureStore persistence for the installation ID, rotating refresh token, purchase token, user ID, and a domain-separated hash of the current Game Center player ID. Access tokens, native proofs, and raw player IDs remain memory-only; partial writes and incomplete credential sets are cleared.
- Added a single authentication coordinator that observes Game Center state, verifies the current local fingerprint before refresh, rotates credentials before bootstrap, exchanges a fresh proof when stored authorization is rejected, and pauses the app behind explicit blocked, temporary-ID, deletion, purge, unsupported, and recoverable-error states.
- Made player switching and local disconnect clear account credentials before another account can become visible. Disconnect suppresses automatic re-entry for the same player until an explicit retry, while a different authenticated player can establish a clean session.
- Preserved a successfully rotated refresh token across a temporary bootstrap outage, kept account content gated, and clamped refresh timers defensively. Non-network authentication failures still remove local authority before fallback or terminal account-state presentation.
- Connected the provider at the application root, exposed the live Game Center alias and a local disconnect action in Settings, and kept privacy, terms, support, and the entertainment-only disclaimer reachable from every unauthenticated state.
- Added coordinator and configuration tests covering first proof exchange, matching-fingerprint restoration, rejected-token fallback, offline rotated-token preservation, player switching, disconnect suppression, deletion pending, HTTPS policy, and malformed configuration.

Verification required before commit:

```text
corepack npm run config:check --workspace @fortuneness/mobile
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api-contracts --workspace @fortuneness/mobile
corepack npm run test --workspace @fortuneness/api-contracts --workspace @fortuneness/mobile
corepack npm run build --workspace @fortuneness/mobile
git diff --check
```

Deployment impact: local Expo TypeScript, app configuration, workspace dependencies, and tests only. Physical Game Center verification and signed iOS setup remain deferred to the documented device gate; no Apple capability, credential, persistent database, API service, legal page, or deployed environment changed.

### 2026-08-06 — Phase 6 fortune and allowance contracts

- Added strict shared schemas for the four intentions, two orientations, three allowance sources, immutable public draw snapshots, current subscription allowance, monotonic period/time-zone state, the fortune-state response, and the intention-only draw request/response.
- Made the authoritative available-draw total self-consistent with its free, subscription, and pack components; invalid period boundaries and subscription entitlement without a verified paid/grace boundary fail contract validation.
- Kept server-owned selection inputs outside the request contract: unknown card keys, locales, seeds, orientation choices, and other properties are rejected.
- Reserved `GET /v1/fortune/state` and `POST /v1/fortunes/draw`, documented bearer and `Idempotency-Key` requirements, first-issuance versus exact-replay statuses, terminal conflicts, deletion/purge outcomes, and retryable content/lock failures in generated OpenAPI.
- Added contract and OpenAPI tests for immutable snapshot shape, strict requests, allowance arithmetic, period ordering, subscription boundaries, authenticated state access, and keyed draw publication.

Verification required before commit:

```text
corepack npm run openapi:generate
corepack npm run openapi:check
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api-contracts
corepack npm run test --workspace @fortuneness/api-contracts
corepack npm run build --workspace @fortuneness/api-contracts
git diff --check
```

Deployment impact: shared Zod/OpenAPI contracts and tests only. No route was mounted, database row or schema changed, allowance was consumed, entitlement was granted, or deployed environment changed.

### 2026-08-06 — Phase 6 account-day and allowance domain rules

- Added dependency-free IANA time-zone canonicalization and account-day boundary calculation using the server ICU database. Boundaries are discovered as the first instant of each local calendar date, so short, long, repeated-hour, and skipped-hour days remain exact without assuming 24 hours.
- Added material time-zone-change planning that chooses the later of the current-zone and requested-zone next resets and establishes the rolling 168-hour eligibility boundary, suppressing both earlier candidate resets.
- Reused the canonical time-zone function during Game Center account creation so login and allowance behavior cannot disagree about aliases or invalid identifiers.
- Added pure subscription reduction for active paid-through and verified future grace boundaries. Billing retry without grace, expiry, and revocation grant no daily bonus even when stale timestamps are present.
- Added clamped allowance arithmetic and the mandatory `FREE_DAILY → SUBSCRIPTION_DAILY → PACK_CREDIT` priority. Pack balances and remaining counters cannot be represented as negative availability.
- Added deterministic tests for UTC, Kyiv spring/fall DST boundaries, eastbound and westbound changes, IANA aliases, invalid zones, active/grace/retry/expired/revoked subscription states, allowance totals, clamping, and priority.

Verification required before commit:

```text
corepack npm run format:check
corepack npm run lint
corepack npm run typecheck --workspace @fortuneness/api
corepack npm run test --workspace @fortuneness/api
corepack npm run build --workspace @fortuneness/api
git diff --check
```

Deployment impact: local pure domain functions, tests, and shared login canonicalization only. No database schema/row, allowance, user time-zone state, subscription, credential, route, or deployed environment changed.
