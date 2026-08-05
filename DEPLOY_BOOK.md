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
