# App Privacy label worksheet

Status: **OPEN** — the automated rows pass; the App Store Connect entry itself and the legal review rows below are not closed.

Owner: the product owner (App Store Connect answers) plus the privacy-policy owner

Implementation baseline: the Phase 12 settings and deletion commit or later

Specification gate: Phase 12 — Settings, reminder, legal, and deletion (spec sections 3.6, 6.3)

This worksheet is the source of truth for the App Store Connect **App Privacy** answers and for `ios.privacyManifests` in `apps/mobile/app.config.ts`. It exists because a passing test can prove what the code sends; it cannot prove that somebody answered Apple's questionnaire the same way. `npm run privacy:validate` keeps the two mechanical halves — the shipped configuration and the declared manifest — from drifting apart.

## What Fortuneness collects

| Apple data type          | Collected | Linked to identity | Used for tracking | Purpose           | What it actually is                                                                             |
| ------------------------ | --------- | ------------------ | ----------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| User ID                  | Yes       | Yes                | No                | App Functionality | The Game Center scoped player identifier, stored only as a salted digest, plus the account UUID |
| Purchase History         | Yes       | Yes                | No                | App Functionality | Apple transaction identifiers and entitlement state needed to grant and audit readings          |
| Other User Content       | Yes       | Yes                | No                | App Functionality | The reading archive and card collection the player generated                                    |
| Product Interaction      | No        | —                  | —                 | —                 | No analytics SDK is installed and no interaction events are sent                                |
| Crash / Performance Data | No        | —                  | —                 | —                 | No crash reporter is installed                                                                  |
| Identifiers (IDFA)       | No        | —                  | —                 | —                 | The app never links `AdSupport` and never presents an ATT prompt                                |
| Contact Info             | No        | —                  | —                 | —                 | Game Center provides no email or postal address to the app                                      |
| Location                 | No        | —                  | —                 | —                 | Only an IANA time-zone name is reported, which is not a location under Apple's definition       |
| Diagnostics              | No        | —                  | —                 | —                 | Server logs are operational and never leave Railway                                             |

Tracking answer: **No**. Fortuneness has no advertising SDK, no third-party analytics, and shares nothing with data brokers, so `NSPrivacyTracking` is `false` and `NSPrivacyTrackingDomains` is empty.

## Required-reason APIs

| Category       | Reason   | Why it applies                                                         |
| -------------- | -------- | ---------------------------------------------------------------------- |
| File timestamp | `C617.1` | `expo-sqlite` and the bundled card art read files the app itself wrote |
| User defaults  | `CA92.1` | React Native and Expo modules read their own settings                  |
| Disk space     | `E174.1` | The local reading cache checks free space before writing               |

## Capabilities and permissions

| Capability                      | Requested | Evidence                                                                      |
| ------------------------------- | --------- | ----------------------------------------------------------------------------- |
| Game Center                     | Yes       | `plugins/with-game-center.cjs`; the only sign-in method the app offers        |
| In-App Purchase                 | Yes       | StoreKit 2 via `modules/fortuneness-iap`                                      |
| Local notifications             | Yes       | Reminder one-shots; permission requested only after an explicit opt-in        |
| Remote push (`aps-environment`) | No        | Deleted by `plugins/with-local-notifications-only.cjs`; asserted by the gate  |
| Camera, microphone, photos      | No        | No `NS*UsageDescription` key exists; `expo-audio` is configured playback-only |
| Location, contacts, calendars   | No        | No framework linked and no prompt presented                                   |
| App Tracking Transparency       | No        | No `NSUserTrackingUsageDescription`; asserted by the gate                     |

## What the player can control

| Control                        | Where                                         | Effect                                                                                |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Daily reminder                 | Settings, after the first reading             | Off by default; the iOS permission prompt is raised only on opt-in                    |
| Consumption information        | Settings, only when the deployment flag is on | Off by default and never inferred from a purchase; revoking stops future sharing only |
| Sound, haptics, reduced motion | Settings                                      | Local presentation only                                                               |
| Account deletion               | Settings → Delete account                     | 30-day processing period, then permanent deletion; cancellable until the purge runs   |

## Rows that automation closes

| Claim                                                     | Evidence                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| No unused permission prompt ships                         | `npm run privacy:validate`                                                 |
| The remote push entitlement is absent                     | `npm run privacy:validate`; `plugins/with-local-notifications-only.cjs`    |
| The manifest declares no tracking                         | `npm run privacy:validate`                                                 |
| Notification permission follows an opt-in, never precedes | `apps/mobile/src/reminders/reminder-scheduler.test.ts`                     |
| Deletion erases the raw purchase token                    | `apps/api/src/account/deletion.integration.test.ts` ("cuts off benefits…") |
| Deletion removes identities, sessions, and readings       | Same integration test                                                      |
| A pending deletion cannot restore application access      | `apps/api/src/account/deletion-management-token.test.ts`                   |

## Rows a person must close

| #   | Row                                                                                               | Status  |
| --- | ------------------------------------------------------------------------------------------------- | ------- |
| 1   | The App Store Connect App Privacy answers match the table above, field by field                   | NOT RUN |
| 2   | The published privacy policy at `EXPO_PUBLIC_PRIVACY_URL` describes exactly these data types      | NOT RUN |
| 3   | The policy states the 30-day deletion processing period and that Apple billing is separate        | NOT RUN |
| 4   | The support page at `EXPO_PUBLIC_SUPPORT_URL` is reachable and answers deletion questions         | NOT RUN |
| 5   | A prebuild on macOS emits `PrivacyInfo.xcprivacy` containing every row of the two manifest tables | NOT RUN |
| 6   | App Review's account-deletion requirement is satisfied by the in-app path, verified on a device   | NOT RUN |
| 7   | Every third-party SDK in the final build ships its own privacy manifest and signature             | NOT RUN |

Row 5 is mechanical but needs Xcode, so it cannot run in this environment. Rows 1 through 4 and 6 are judgement calls that belong to the people who own the store listing and the policy text.
