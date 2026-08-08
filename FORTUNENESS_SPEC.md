# Fortuneness — Product and Technical Specification

Status: **Implementation-ready draft**  
Product: **Fortuneness**  
Launch platforms: **iPhone and iPad**  
Backend: **Node.js API + PostgreSQL on Railway**  
Primary identity: **Sign in with Apple**
Last updated: **2026-08-05**

This document is the canonical build specification for Fortuneness. It is ordered from the earliest product and account decisions through implementation, verification, TestFlight, and App Store launch.

Labels used below:

- **[required]** comes directly from the product brief.
- **[decision]** resolves an ambiguity in the brief so implementation can proceed.
- **[added]** is a product or engineering requirement added to make the app safe, shippable, and reliable.

---

## 1. Product contract

### 1.1 Product promise

Fortuneness is a calm, mysterious daily ritual. A player opens the app, sets an optional intention, draws a face-down tarot card, reveals it, and receives a short reflective fortune. Every issued fortune is saved to the player's collection for the lifetime of the Fortuneness account.

The app is entertainment and a tool for reflection. It must never claim certainty, predict death or harm, diagnose a condition, or replace medical, legal, financial, or mental-health advice.

### 1.2 Launch requirements

1. **[required]** Every authenticated player receives one free fortune per day.
2. **[required]** Authentication uses the player's Apple Account through Sign in with Apple.
3. **[required]** Every fortune is represented by a tarot card and revealed through a card-focused interface.
4. **[required]** The app includes a repeatable StoreKit consumable called **10 Fortune Pack**. Each verified non-subscription purchase grants 10 draw credits.
5. **[required]** The app includes a subscription that adds 10 fortunes per day on top of the one free daily fortune.
6. **[required]** The app has one root destination and many pages, including Shop and Collection.
7. **[required]** The visual direction is mysterious, celestial, premium, and tarot-led.
8. **[required]** The UI is adaptive and verified on iPhone and iPad without clipping, overlap, unsafe-area errors, or orientation bugs.
9. **[required]** PostgreSQL hosted by Railway is the system of record.
10. **[required]** Tarot illustrations are produced with the Google ADC image-generation workflow. Card structure, text, symbols, interaction, layout, and animation are implemented in code.

### 1.3 Resolved product decisions

These decisions are part of V1 unless the owner explicitly changes them before the named implementation phase.

| Topic | V1 decision |
| --- | --- |
| Free allowance | One draw per monotonic allowance period corresponding to the player's account-local day. It does not accumulate. |
| Subscriber allowance | 10 additional draws per eligible allowance period, for 11 total including the free draw. Unused subscriber draws do not roll over. |
| Fortune pack | A repeatable StoreKit consumable. Each verified purchase grants 10 extra draw credits. Unused benefits remain until spent, reversed after a verified refund, or forfeited when confirmed account purge completes; minimized financial records follow section 6.3. Product copy never calls it a “one-time purchase.” |
| Allowance spending order | Free daily allowance, then subscription daily allowance, then pack credits. This preserves paid credits. |
| Daily reset | Normally midnight in the player's server-recorded canonical IANA time zone. An accepted zone change extends the current period to the single later candidate boundary defined in section 2.4 and cannot create an intermediate allowance. |
| Root navigation | One root destination called **Oracle**. Collection, Shop, Settings, and details are pushed or presented as pages. There is no multi-item bottom tab bar. |
| Launch deck | The complete 78-card tarot structure: 22 Major Arcana and 56 Minor Arcana. Art is original and generated for Fortuneness. |
| Card readings | Upright and reversed readings across four intentions: General, Love, Work, and Growth. |
| Fortune generation | Curated, versioned content stored in PostgreSQL. No live generative-AI request is required to draw a fortune. |
| Duplicates | A card may appear again, but selection favors unseen cards and avoids recent repeats when the content pool allows. Every draw remains a distinct archived fortune. |
| Launch subscription | One standard month-to-month, pay-as-you-go auto-renewable product. V1 does not use Apple's monthly plan with a 12-month commitment. Validate the configured `billingPlanType`; an annual option is a post-launch addition. |
| Platform guarantee | iOS and iPadOS are fully supported at launch. Mac, Apple Vision, Apple TV, and Apple Watch are separate follow-up targets and must not be advertised as supported until individually tested. |
| Offline behavior | Card art and canonical deck metadata ship with the app. The discovery summary and 200 most recent complete readings are persisted per player; older opened pages may be cached within the storage limit. Offline views identify saved/partial data and the last sync time. New draws, purchase initiation, **Restore Purchases**, and entitlement decisions require a network connection. |
| Admin UI | No admin website is required for V1. Versioned seed files and validation scripts manage the initial deck and fortune catalog. |
| Launch locale | V1 launches with English (`en`) UI, card metadata, fortune content, legal copy, and artwork descriptions. StoreKit prices and system commerce UI remain Apple-localized. Unsupported device locales resolve to English; historical draw snapshots retain their issuance language. |
| Pending reveal | At most one issued-but-unviewed draw exists per player. Its full readable presentation must be acknowledged before another draw can consume allowance. |

### 1.4 Success criteria

V1 is ready to ship only when all of the following are true:

- A new player can use Sign in with Apple and draw a fortune without creating a password or entering personal information.
- A second device using the same Apple Account sees the same collection, quota, subscription state, and pack-credit balance.
- Concurrent taps, retries, process termination, or switching devices cannot grant an extra free/subscriber draw or charge pack credits twice.
- Outside a verified refund/revocation or completed player-confirmed account deletion, a completed purchase benefit is never lost after the App Store succeeds, including when the app is killed during delivery.
- A refund, revocation, expiration, renewal, grace period, or account switch is eventually reflected by the backend.
- A duplicate, delayed, out-of-order, or replayed StoreKit event cannot incorrectly duplicate, transfer, lose, or regress a benefit; authoritative refund, revocation, and deletion transitions apply exactly once.
- Every launch page works in compact and regular width, portrait and landscape, safe areas, iPad split view, large Dynamic Type, VoiceOver, and Reduce Motion.
- The daily draw remains available even if the player has never paid.
- Shop copy states exactly what is bought, uses App Store localized prices, and does not create false urgency.
- All 78 art assets pass visual, dimension, file-size, contrast, and duplicate checks.
- App Review can exercise authentication, the free draw, both IAP types, **Restore Purchases**, and account deletion using documented review instructions.
- Account deletion immediately removes normal access, clearly separates Fortuneness deletion from Apple subscription cancellation, and produces a deterministic result for unused credits, active subscriptions, late transactions, and later account recreation.

### 1.5 Explicit non-goals for V1

- Social feeds, friend readings, chat, direct messaging, and user-generated content.
- Gambling, cash prizes, tradable cards, competitive leaderboards, randomized paid rarity, or crypto/NFT features.
- Live AI-generated fortune text.
- A web client, Android client, or content-management website.
- Advertising or third-party tracking.
- Full Apple Watch, Apple TV, macOS, or visionOS experiences.

---

## 2. Player experience and business rules

### 2.1 First launch

1. Show the native splash, then a short in-app loading scene using the same background and mark.
2. Initialize `GKLocalPlayer` immediately.
3. Restore a valid Fortuneness refresh session silently when one exists.
4. When a session is absent or sensitive reauthentication is required, present the native Sign in with Apple sheet and exchange its identity token with the Fortuneness API.
5. The backend verifies the Apple signature, creates or finds the player, and returns the app session and current state.
6. Show at most three concise onboarding pages:
   - one free reading every day;
   - tap a card to reveal guidance, not certainty;
   - readings are saved to the collection.
7. Ask for the player's intention. Default to **General** so this step can always be skipped.
8. Land on Oracle with the free card ready to draw.
9. Do not show a subscription interstitial before the player has experienced the free reading.

If Sign in with Apple is unavailable or cancelled, show a purposeful sign-in state with an Apple-approved button. Do not silently create an unrelated anonymous account. Launch, authentication, deletion-management, and blocked screens always expose Privacy Policy, Terms of Use, the entertainment disclaimer, and support without requiring a Fortuneness session.

### 2.2 Daily draw ritual

1. Oracle loads `GET /v1/fortune/state` and displays the authoritative available-draw total and next-reset time.
2. The player selects or keeps an intention: General, Love, Work, or Growth.
3. The player taps or drags the face-down card.
4. The client sends a UUID idempotency key and the intention to `POST /v1/fortunes/draw`.
5. The backend atomically selects the allowance source, issues the fortune, and saves its immutable snapshot.
6. Only after the server responds does the reveal animation begin.
7. The card flips, then the headline, reading, gentle action, and affirmation appear in sequence.
8. The reading is already saved. “Added to Collection” is confirmation, not a second write. A new draw has `viewedAt = null`.
9. Before animation begins, the client persists the draw ID and local presentation step as `pendingReveal`. It calls the idempotent viewed endpoint only after the headline, message, action, and affirmation are rendered and reachable by VoiceOver.
10. While an unviewed draw exists, a draw request returns `UNVIEWED_READING_PENDING` with that owned draw and consumes nothing. The client presents **Continue your reading** and may replay from a safe animation boundary, but it never rerolls.
11. The client retries the viewed acknowledgement until accepted. It then clears `pendingReveal` and shows the next available card or the reset countdown and non-aggressive Shop link.
12. The client keeps one draw request and one `Idempotency-Key` in flight at a time. Additional taps are ignored until that request resolves; deliberate subsequent draws use new keys after the prior reading is viewed.

### 2.3 Allowance semantics

Let `P` be the current monotonic `AllowancePeriod` and `subscriptionEntitled(now)` be true only for a verified unrevoked paid period with `paidThrough > now` or a verified grace period with `graceThrough > now`:

```text
available(P, now) = max(1 - freeUsed[P], 0)
                  + (subscriptionEntitled(now) ? max(10 - subscriptionUsed[P], 0) : 0)
                  + spendablePackCredits
```

Rules:

- Free and subscription terms are clamped to zero.
- Free allowance exists regardless of purchase or subscription state.
- Subscription cancellation does not remove access before the verified paid-through date.
- Verified active and grace-period subscriptions grant the 10 daily bonus draws.
- Expired, revoked, or refunded subscriptions do not grant new daily bonus draws.
- Billing retry without an active grace period does not grant new bonus draws. The API returns a neutral billing-state message and an Apple subscription-management link.
- Subscription draws reset daily and never become pack credits.
- Pack credits survive daily reset and subscription changes.
- `spendablePackCredits` is always nonnegative. Refunds remove only unspent units from the refunded purchase grant; consumed refunded units are recorded as unrecovered refund units for audit and abuse review, never as debt that silently absorbs a later purchase.
- Every later verified 10 Fortune Pack purchase makes 10 new units spendable. Repeated refund abuse may block new pack purchases pending support review, but it never removes the free daily draw or valid subscription allowance.
- The client never computes entitlement or balance as the source of truth.

### 2.4 Account day and time-zone behavior

- The first successful authentication records the device's alias-normalized canonical IANA identifier, for example `Europe/Kyiv`, as `accountTimeZone`.
- On each authenticated launch, the client reports `reportedDeviceTimeZone`. A difference is never applied silently; Oracle and Settings offer **Use device time zone**.
- `User` stores `accountTimeZone`, optional `pendingTimeZone`, `timeZoneEffectiveAt`, and `nextTimeZoneChangeEligibleAt`. Settings displays all applicable values and the current absolute `nextResetAt`.
- A request matching the current or already-pending canonical zone is idempotent and returns existing state without consuming change eligibility. Any other canonical identifier after alias normalization is a material change; one accepted material change is allowed per rolling 168 hours.
- While holding the user lock, an accepted change computes `timeZoneEffectiveAt` as the later of the next reset in the old zone and the next reset in the requested zone, then changes the current period's sole `resetAt` to that instant. Both earlier candidate calendar resets are suppressed; no intermediate period or allowance is created. Until the effective instant, allowances remain in that same current period under the old-zone label.
- At `timeZoneEffectiveAt`, close the current half-open period `[startedAt, resetAt)`, create exactly one new monotonic allowance-period ID beginning at that instant with its next boundary calculated in the new zone, and change the account zone. The client prepares the notification transition when the change is accepted as described below. Allowance uniqueness uses period ID and UTC boundaries rather than a reusable local-date string.
- A request inside 168 hours returns `409 TIME_ZONE_CHANGE_LIMITED` with `nextEligibleAt` and a support link. Support intervention uses an authenticated, audited operational script/runbook; no client bypass exists.
- The profile/state contracts return `accountTimeZone`, `reportedDeviceTimeZone`, `pendingTimeZone`, `timeZoneEffectiveAt`, `nextTimeZoneChangeEligibleAt`, absolute `currentPeriodStartedAt`, and absolute `nextResetAt`.
- Day boundaries use a time-zone-aware library. Tests cover eastbound and westbound travel, multi-device disagreement, a rejected second change, DST gaps/repetitions, year boundaries, and process termination while a change is pending.
- The server clock is canonical. Device clock changes do not grant draws.

### 2.5 Card selection behavior

Selection runs inside the same database transaction as allowance consumption. The production seed guarantees complete English coverage for every active card, intention, and orientation.

1. Resolve the server-recorded device locale from the latest authenticated bootstrap against the supported-locale allowlist; the draw request cannot override it. V1 resolves unsupported locales and regional variants to `en`, so a draw never fails merely because of device locale.
2. Select orientation first using one cryptographic draw: upright probability `0.70`, reversed probability `0.30`. A configuration change versions these values. Reversed cards are never described as inherently bad.
3. Build active card/template candidates for resolved locale, intention, and selected orientation. If no base candidate exists, return `CONTENT_UNAVAILABLE`, alert operations, and consume nothing.
4. Remove templates used in the preceding 30 days only when at least one candidate remains. From that result, remove the last three card keys only when at least one candidate remains. This defines the exact relaxation order: recent-template exclusion is relaxed first, then recent-card exclusion.
5. If both unseen and seen card groups remain and not all 78 cards are unlocked, choose the unseen group with probability `0.65` and the seen group with probability `0.35`. This is a group probability, not a per-card multiplier. If only one group remains, choose it with probability `1.0`.
6. Choose a card uniformly inside the selected group, then choose uniformly among the eligible template variants for that card. Every random choice uses server-side cryptographic randomness; the client never supplies a seed or card ID.
7. Tests use an injected deterministic random source and statistical tolerances: orientation and unseen-group frequencies must remain within two percentage points over 100,000 selections, and every eligible candidate must be reachable.
8. Snapshot resolved locale, card metadata, illustration-alt copy, template/content version, and all displayed copy onto the draw row so later edits cannot rewrite history.

Random selection is for variety, not paid rarity. Every card and reading has equal functional value.

### 2.6 Collection semantics

Collection has two modes inside one page:

- **Deck** shows 78 canonical card slots, unlocked/locked state, upright/reversed discoveries, and overall progress.
- **Readings** shows the chronological archive of every issued fortune, including repeats.

An unlocked card is never removed when a subscription ends. Deleting an account removes the personal collection according to the deletion policy.

The offline archive shows its saved-reading count and last successful sync time. Filters operate only on saved readings while offline and never imply that a partial cache is complete. On reconnect, refresh the discovery summary and newest page before merging older cached pages. Clear all account-scoped cache data on logout, deletion request, Apple identity mismatch, or ownership mismatch.

### 2.7 Notifications

After the first completed reading, offer an optional local daily reminder. Do not request notification permission at first launch.

- Default reminder time: 09:00 in the account time zone.
- The player can change time or disable reminders in Settings.
- Copy remains gentle: “Your daily card is ready.”
- When a zone change is accepted, immediately replace the repeating reminder with a bounded, de-duplicated set of one-shot absolute notifications: old-zone occurrences before `timeZoneEffectiveAt` and new-zone occurrences at or after it. Refresh the schedule at every launch, stay within the platform pending-notification limit, and prefer stopping reminders over firing in the wrong zone if the bounded schedule expires.
- Phase 12 tests the old/new-zone transition while the app remains terminated; no background process or push delivery is assumed.
- V1 uses local notifications; no push-token backend is needed for the daily reminder.

---

## 3. Information architecture and page contract

### 3.1 Navigation map

```text
App root
├── Launch / Sign in with Apple
│   ├── Privacy Policy
│   ├── Terms of Use
│   ├── Entertainment disclaimer
│   └── Support
├── Onboarding (first successful authentication only)
└── Oracle (the only root destination)
    ├── Reveal
    ├── Fortune detail
    ├── Collection
    │   └── Card detail
    ├── Shop
    │   ├── Purchase result
    │   └── Manage subscription (Apple system destination)
    └── Settings
        ├── Reminder
        ├── Appearance and motion
        ├── Privacy and data
        ├── Delete account
        └── About, support, terms, and disclaimer
```

On iPhone, pages push on a navigation stack and Shop may use a full-height sheet. On iPad, Collection and Settings may use a sidebar/detail or centered sheet where it improves use of regular width. The information architecture remains one root destination on every device.

### 3.2 Oracle page

Required elements:

- App mark and compact page actions for Collection, Shop, and Settings.
- Greeting or ritual prompt, not the Apple identity identifier.
- Intention selector with four accessible options.
- Dominant face-down tarot card surface.
- Available-draw summary and next reset.
- Sole unviewed-reading resume state when an issued card was not fully presented and acknowledged.
- Loading, offline, exhausted, authentication-lost, and server-error states.

The Shop action may show a subtle dot after allowance exhaustion, but no flashing badge or countdown pressure.

### 3.3 Reveal and fortune detail

The face contains:

- Code-rendered number, card name, suit/rank symbol, and frame.
- Generated central illustration.
- Upright/reversed orientation.
- Fortune headline.
- Main message of roughly 50–100 words.
- “Carry this with you” action of roughly 10–25 words.
- One short affirmation.
- Date, intention, and allowance source in an optional info section. Do not visually label a paid reading as more powerful.
- Share button only if the generated share image excludes private/account data. Sharing is an added feature and can move post-launch if schedule is tight.

### 3.4 Collection page

Required states and controls:

- Segmented control: Deck / Readings.
- Progress: `unlocked / 78`.
- Filters: arcana, suit, upright/reversed discovery, intention, and date for readings.
- Stable, paginated history; newest first.
- Locked cards use the common card back and accessible text “Not yet discovered.”
- Card detail lists discovery date and all readings for that card.
- Empty, partial, complete, loading, offline-cache, and pagination-error states.

### 3.5 Shop page

The shop is visually part of the same world, but clarity outranks mystery for purchase terms.

Sections:

1. Current status: free draw, subscriber draws remaining today, and pack-credit balance.
2. **10 Fortune Pack**: repeatable consumable App Store purchase, exactly 10 spendable credits per accepted purchase, and repeat purchase allowed. Unused credits remain until spent, a verified refund removes unspent units from that grant, or their benefit is forfeited when Fortuneness account purge completes.
3. **Oracle+ Monthly**: a standard month-to-month, pay-as-you-go auto-renewable subscription with 10 additional fortunes every eligible allowance period while active or in a verified grace period. It auto-renews monthly until cancelled and has no 12-month commitment.
4. **Restore Purchases**. Supporting copy: “Rechecks your Apple subscription and synchronizes pack credits already recorded for this Fortuneness account.”
5. Manage subscription.
6. Required subscription disclosure, Terms of Use, and Privacy Policy links.

Rules:

- Fetch product title, localized price, billing period, trial, and offer eligibility from StoreKit. Never hardcode a currency or price.
- Disable purchase buttons while a transaction is pending.
- Treat user cancellation as a neutral outcome, not an error alert.
- Show pending/Ask to Buy state without granting content early.
- Finish a consumable transaction only after the backend durably accepts delivery and returns `safeToFinish: true`, including when the unique grant was already applied or was routed to its known owner.
- **Restore Purchases** is an explicit user action that calls `AppStore.sync()`, then reconciles StoreKit and the server. Normal launch never calls `AppStore.sync()`. Consumable pack credits come from the Fortuneness server ledger for the same active account, not from `currentEntitlements`.
- Family Sharing is off for V1 to avoid ambiguous purchase ownership across Apple Accounts.

### 3.6 Settings and account pages

Required controls:

- Apple Account connection and sync state.
- Account time zone and reset explanation.
- Reminder on/off and time.
- Sound on/off, haptics on/off, and motion preference: **Follow System** by default or **Reduce More**. Fortuneness never re-enables motion disabled by iOS.
- **Restore Purchases** with the supporting copy from section 3.5, and Manage Subscription.
- When the consumption-information deployment flag is enabled, **Share purchase-use information with Apple** is an optional post-purchase control, off by default: “If Apple reviews a refund request, allow Fortuneness to share limited information about how the eligible pack or subscription was used. This never affects purchases, draws, or refund eligibility. Turning it off stops future sharing but cannot retract information already sent.” Never make consent a purchase prerequisite or interrupt purchase success with it.
- Privacy Policy, Terms of Use, support email, version/build number, and entertainment disclaimer.
- Delete account flow with clear consequence, recent Apple reauthentication, explicit confirmation, immediate normal-session revocation, and deletion-request status.

“Disconnect on this device” clears Fortuneness tokens and local account data; it does not sign the device out of its Apple Account.

Before deletion confirmation, show a plain-language summary that:

- normal sessions and account access are revoked as soon as the request commits;
- readings, collection progress, preferences, and unused pack credits become inaccessible when the deletion request commits. They are permanently purged or forfeited only when scheduled purge completes; cancellation before purge restores the account and re-evaluates its then-current credits and entitlements. Minimized financial records may be retained as described in the Privacy Policy;
- deleting Fortuneness data does not cancel an App Store subscription or stop Apple billing;
- when Apple reports an active, grace/retry, or paid-through-cancelled subscription, request that the player cancel it through **Manage Subscription** before continuing, but keep **Request account deletion** enabled whether or not cancellation occurs; access ends when the request commits and purge is scheduled for the displayed date;
- late renewals, refunds, or unfinished transactions may be retained only as minimized financial records and grant no benefit to a purged account;
- if Oracle+ remains active after deletion, Apple may continue billing while the deleted or recreated Fortuneness account receives no Oracle+ benefit; cancelling through Apple before deletion avoids future charges; and
- after purge, the same Apple subject creates a new empty Fortuneness account. Deleted readings and credits and the old subscription benefit cannot be restored or transferred to it.

Always require a second confirmation acknowledging that access ends on commit and data/credit loss becomes permanent if scheduled purge completes without cancellation. Require a separate Apple-billing acknowledgment only when the subscription is active, in grace/billing retry, or cancelled but still paid through; if status cannot be verified, disclose that uncertainty and show **Manage Subscription**. Reauthentication during the 30-day processing period returns a deletion-management state that can show status or cancel the request; it never silently issues a normal session.

---

## 4. Visual, interaction, and adaptive-layout specification

### 4.1 Art direction

The target is **celestial mystery**, not horror, casino, or a generic medieval fantasy game.

- Background: layered midnight indigo and near-black violet.
- Accent: restrained antique gold, never bright yellow.
- Supporting tones: moon silver, muted amethyst, deep teal, warm parchment.
- Texture: subtle grain, mist, constellations, and slow light falloff.
- Shape language: tall 2:3 cards, fine borders, crescent and star geometry, rounded sheets, generous space.
- Motion: deliberate and quiet—card float, flip, glow, and text reveal.
- Sound: optional soft paper, chime, and low shimmer. Never autoplay loud audio.

Initial tokens:

| Token | Value |
| --- | --- |
| `color.background` | `#0D0A1A` |
| `color.surface` | `#171127` |
| `color.surfaceRaised` | `#211735` |
| `color.gold` | `#D4AF67` |
| `color.goldMuted` | `#9C8151` |
| `color.text` | `#F4EFE6` |
| `color.textMuted` | `#B8AEC5` |
| `color.focus` | `#C7B4FF` |
| `radius.card` | 24 pt |
| `card.aspectRatio` | 2 / 3 |
| `touch.minimum` | 44 × 44 pt |

Color values are starting tokens, not permission to skip contrast testing.

Use an appropriately licensed editorial serif for display headings and the Apple system font for body/control text. Do not render generated text inside card illustrations; labels and symbols are code-rendered so they remain sharp, localizable, and accessible.

### 4.2 Card construction

Each visible tarot card is layered in code:

1. Shadow/glow layer.
2. Outer card material and gold stroke.
3. Clipped generated illustration.
4. Optional gradient scrim for text contrast.
5. Number, name, suit glyph, and orientation indicators.
6. Accessibility overlay and press/gesture target.

The common card back is a symmetric original celestial pattern. A 180-degree rotation must not reveal orientation before the flip.

### 4.3 Reveal motion

- Default card flip duration: 600–750 ms.
- Use native-driven/Reanimated transforms and opacity; avoid JS-thread frame-by-frame animation.
- The server response is required before the flip begins.
- Haptic sequence: light selection on intention, medium impact on draw, soft success on reveal. Respect the player setting.
- With Reduce Motion, replace 3D flip/parallax with a 150–250 ms crossfade and immediate readable text.
- Background particles pause when the app is inactive and are capped to protect older devices.
- Interaction remains functional at 30 fps; the target is a stable 60 fps or the device's native refresh rate.

### 4.4 Responsive layout rules

No page is designed from device-name checks. Layout responds to available window width, height, safe-area insets, font scale, orientation, and input method.

| Window | Behavior |
| --- | --- |
| Compact, under 600 pt | Single column, card width `min(84vw, 340pt)`, vertical scroll, full-width primary action. |
| Medium, 600–899 pt | Centered column up to 680 pt; collection uses 3–4 columns depending on actual card minimum width. |
| Regular, 900 pt and above | Oracle may use a two-column composition; content max width 1100 pt; collection uses an adaptive grid. |

Additional rules:

- Support portrait and landscape on iPhone and iPad.
- Do not require full screen on iPad; support Split View and Stage Manager sizes.
- Respect top, bottom, left, and right safe areas, including landscape sensor housings and home indicator.
- All pages scroll when content plus Dynamic Type exceeds the viewport.
- Never use a fixed screen height for the main content.
- Keep primary content readable at widths down to 320 pt.
- Modals have a compact full-screen fallback if their preferred sheet width cannot fit.
- Collection grids use a minimum card cell width, not a hardcoded column count.
- Keyboard appearance must not hide the active control, although V1 contains very little text input.

### 4.5 Accessibility definition of done

- VoiceOver follows a logical order and announces card name, orientation, intention, state, and button actions.
- An idle face-down card is announced as “Draw a tarot card.” A pending face-down reveal is “Continue your saved reading,” and a request in progress is “Drawing your card.” None exposes the unrevealed result.
- Dynamic Type is supported through accessibility sizes without truncating essential content.
- Touch targets are at least 44 × 44 pt.
- Text and meaningful controls meet WCAG AA contrast; decorative gold may be lower only when it carries no information.
- Color is never the only state signal.
- Reduce Motion and Reduce Transparency have intentional fallbacks.
- Sound and haptics are optional and never the sole feedback.
- Decorative images are hidden from accessibility. A meaningful card label combines localized card name, orientation, intention, and a human-reviewed 8–25-word illustration description that conveys visible imagery without claiming an interpretation or repeating the fortune.
- Loading is announced without repeatedly interrupting the player.

---

## 5. Technical architecture

### 5.1 Repository layout

Use the proven structure from `F:\English-APP\English_APP`, reduced to Fortuneness's actual scope:

```text
fortune_APP/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── db/
│   │       ├── middleware/
│   │       ├── routes/
│   │       ├── services/
│   │       └── utils/
│   └── mobile/
│       ├── app/                 # Expo Router stack routes
│       ├── assets/
│       ├── modules/
│       │   └── fortuneness-iap/ # local Expo module, Swift/StoreKit 2
│       └── src/
│           ├── components/
│           ├── features/
│           ├── lib/
│           ├── state/
│           └── theme/
├── packages/
│   ├── api-contracts/           # Zod request/response schemas
│   ├── shared-types/
│   └── fortune-content/         # versioned content + validation
├── tools/
│   └── card-assets/             # ADC prompt manifest + asset QA
├── docs/
├── .github/workflows/
├── package.json
├── railway.json
└── FORTUNENESS_SPEC.md
```

### 5.2 Stack

| Layer | Choice |
| --- | --- |
| Workspace | npm workspaces, Node.js 24 LTS, strict TypeScript |
| Mobile | React Native through the latest stable Expo SDK selected during scaffold; Expo Router; development builds/EAS, not Expo Go |
| Mobile server state | TanStack Query |
| Small local UI state | Zustand or scoped React context; avoid duplicating API state |
| Animation | React Native Reanimated |
| Secure token storage | `expo-secure-store` / iOS Keychain |
| Offline account cache | Account-partitioned `expo-sqlite`, protected by iOS Data Protection. Persist the latest 200 complete readings; apply least-recently-used eviction to older cached pages above 50 MiB. Never store tokens or StoreKit JWS payloads here. |
| Native Apple bridges | Local Expo Modules written in Swift for GameKit and StoreKit 2 |
| API | Express 5, Zod edge validation, Pino structured logs |
| Database | PostgreSQL on Railway, Prisma ORM and checked-in migrations |
| Tests | Vitest/Supertest for API; React Native Testing Library; native Swift unit tests where practical; Maestro/Detox-style E2E selected during scaffold |
| CI/CD | GitHub Actions for static checks/tests; Railway for API; EAS Build/Submit/Update for mobile |
| Monitoring | Sentry or equivalent crash/error reporting with no advertising identifier |

The exact Expo SDK and its bundled React Native versions are locked together in Phase 1 and committed. Do not independently upgrade React Native. StoreKit requires the local native module, so Expo Go is not a supported end-to-end development environment.

### 5.3 Environments

Maintain three isolated environments:

| Environment | API/database | Apple purchases | Mobile distribution |
| --- | --- | --- | --- |
| Local | Local API + local PostgreSQL | Mac/Xcode Run scheme with a local `.storekit` file and exported StoreKit test certificate; no App Store server APIs or notifications | Xcode development build on simulator/device |
| Staging | Railway staging service + staging PostgreSQL | App Store sandbox | Internal TestFlight / preview build |
| Production | Railway production service + production PostgreSQL | App Store production | App Store production build |

An EAS cloud-built development client and every TestFlight build use App Store Sandbox products rather than the local Xcode StoreKit session. Local Xcode JWS is accepted only by a local verifier configured with `Environment.XCODE` and the exported test certificate. Staging trusts only Apple Sandbox; production trusts only Apple Production. Test certificates never enter Railway. Never point a preview build at production, and store transaction environment in every business key so environments cannot collide.

### 5.4 API conventions

- Prefix public app routes with `/v1`.
- JSON request/response schemas live in `packages/api-contracts` and are validated on both boundaries.
- Timestamps use ISO 8601 UTC strings.
- Database timestamps use `timestamptz` semantics.
- IDs are UUIDs. `FinancialSubject.id` is an internal owner key and is never sent to StoreKit. The server issues a separate random UUID purchase token as `appAccountToken`, stores its versioned HMAC for lookup and its encrypted raw value only while the account needs it, and returns it through authenticated bootstrap/catalog state. Purge erases the recoverable raw token but may retain its one-way binding for future Apple event routing.
- Cursor pagination is used for readings; no offset pagination for a growing history.
- Every response carries `x-request-id`; logs include the same ID.
- Authentication, deletion-management, purchase-token/catalog, and transaction-delivery responses use `Cache-Control: no-store`; the raw purchase token never enters logs, analytics, or the SQLite reading cache.
- `Idempotency-Key` is a client-generated UUID in the request header. It is required for `POST /v1/fortunes/draw` and `POST /v1/auth/refresh`; StoreKit transaction IDs and App Store notification UUIDs are the canonical commerce keys.
- Scope an idempotency key by mutation actor (`userId` for draw; refresh-token family and presented-token digest for refresh), HTTP method, and normalized route. After validation, hash the canonical request with SHA-256 and persist key, request hash, and domain result in the same transaction as the mutation.
- Repeating a key with the same request hash returns the original domain result. Reusing it with different input returns `409 IDEMPOTENCY_KEY_REUSED`. A validated terminal business outcome—including draw success, `UNVIEWED_READING_PENDING`, or `NO_DRAWS_AVAILABLE`—reserves the key in the same transaction as that outcome. Authentication/validation failures and retryable infrastructure/database failures do not reserve it.
- Errors use `{ "error": { "code": string, "message": string, "requestId": string, "retryable": boolean, "sameKeyRetrySafe": boolean, "details"?: object } }`. Zod defines code-specific `details`; unknown free-form fields, secrets, and owner-identifying commerce data are forbidden. On routes without an idempotency key, `sameKeyRetrySafe` is `false` by definition.
- Player-facing messages are chosen by the client from stable error codes. Server messages are diagnostic fallbacks, not UI copy.

---

## 6. Identity, session, and account security

### 6.1 Sign in with Apple authentication flow

1. At startup, restore an existing Fortuneness refresh-token session without presenting an Apple sheet. If no valid session exists, render the native `AppleAuthenticationButton`.
2. For sign-in or sensitive reauthentication, generate a fresh UUID nonce and pass it to `AppleAuthentication.signInAsync` without requesting name or email scopes.
3. Require a nonempty Apple identity token. Post it, the exact nonce, and allowlisted advisory device locale/time-zone fields to `/v1/auth/apple` over TLS.
4. The backend verifies the JWT with the key whose `kid` matches Apple's fixed `https://appleid.apple.com/auth/keys` JWKS, accepting only `RS256`.
5. Require issuer `https://appleid.apple.com`, audience exactly equal to configured `APP_BUNDLE_ID`, the matching nonce claim, valid `exp`/`iat`, and the configured freshness/skew window.
6. Reject a bounded SHA-256 replay fingerprint for every previously accepted identity token. Raw identity tokens and Apple subject identifiers are discarded after verification and never logged.
7. HMAC the domain-separated Apple `sub` with the current and supported previous server keys. Use `{ provider: SIGN_IN_WITH_APPLE, keyVersion, subjectDigest }` as the unique authenticating identity and backfill the current digest after a successful old-key match.
8. Identity lookup/create is one database transaction so concurrent first logins return the same winning user without an orphan row.
9. On success, issue a 15-minute access token plus a rotating 30-day refresh-token family. The Apple identity token is never used as an application session.

The Apple JWKS URL is a code constant rather than request input, eliminating the former identity-proof SSRF surface. The deployment still records `appleid.apple.com` in its outbound inventory and applies a bounded fetch timeout.

Apple's subject is stable for this app/developer scope, but it is not derivable from the former Game Center identity. A production migration with existing Game Center users therefore requires an explicit one-time account-linking ceremony that authenticates both identities; never guess or auto-merge them.

### 6.2 Session rules

- Store refresh tokens in Keychain and only their hashes in PostgreSQL. Keep access tokens in memory when practical.
- Access tokens expire after 15 minutes and contain `sub`, session-family ID, user `sessionVersion`, immutable identity `auth_time`, `iat`, `exp`, issuer, and audience. Refresh copies the original `auth_time`; only a newly verified Apple identity token advances it.
- Every authenticated request checks authoritative `User.status`, matching `sessionVersion`, and an active session family. Deleted, blocked, logged-out, or superseded sessions therefore stop authorizing immediately rather than remaining valid until JWT expiry.
- Increment `User.sessionVersion` whenever all sessions must be invalidated. Logout revokes the current family. User-scoped mutations recheck `User.status = ACTIVE`, `sessionVersion`, and session family inside their database transaction after acquiring the user lock.
- Session writers use the global lock order `User → SessionFamily → RefreshToken`; a flow that also needs commerce state locks `FinancialSubject` last. Refresh, logout, and deletion recheck active user/session version and family state after those locks, so refresh cannot commit across deletion and lock inversion cannot deadlock them.
- Refresh rotation atomically consumes the presented token and creates exactly one replacement. Each refresh attempt carries a UUID `Idempotency-Key`.
- For 120 seconds, an exact same-key/same-hash retry may return the same encrypted replay receipt containing the already-issued replacement. The receipt is encrypted with a dedicated rotatable key, expires automatically, and is the only exception to hash-only refresh-token storage.
- Reuse of a consumed refresh token with another key, another request hash, or after the replay window revokes the whole family. Concurrent refreshes follow the shared lock order; only one replacement references a predecessor.
- A successful logout returns `204`. A repeated call with the now-revoked family fails normal authoritative authentication with `401`; the client still treats local token deletion as complete.
- Reauthenticate through Sign in with Apple if refresh is unavailable or replay-revoked. Sensitive reauthentication must resolve to the same local identity fingerprint as the active session.
- A deliberate local disconnect pauses mutations and clears the prior account's Keychain material, memory, and SQLite partition before another Apple identity can establish a session.
- Never merge external identities automatically. Rate-limit authentication by IP hash and identity hash without logging raw identifiers; retention for rate-limit hashes is documented and bounded.

### 6.3 Account deletion

- `DELETE /v1/me` requires an active access token whose authoritative session family has `identityAuthenticatedAt` no more than 300 seconds old and whose JWT `auth_time` matches it, plus the applicable confirmations in section 3.6. The client obtains that session by completing `POST /v1/auth/apple` with a fresh identity token immediately before deletion. An active subscription never disables **Request account deletion**.
- In one transaction and the shared lock order, lock and recheck the active user/session, create the sole deletion request, set `DELETION_PENDING`, increment `sessionVersion`, and revoke every session family. Return `202` only after commit; normal application paths are unavailable immediately. A concurrent or post-commit access-token retry returns `423`, and a lost response is recovered through fresh Apple authentication and deletion-management state. The unique active request makes the effect singular without promising response replay on a revoked session.
- Default purge processing deadline is 30 days and is disclosed. Reauthentication before purge issues no normal tokens; it returns `accountStatus: DELETION_PENDING`, dates, and a short-lived deletion-management token scoped only to `GET /v1/me/deletion` and cancellation.
- Cancellation locks the same rows as the purge worker and succeeds only if it wins before purge. It restores `ACTIVE`, increments `sessionVersion`, issues a new session, and re-evaluates the still-linked financial subject's current entitlement/credits. A completed purge returns `410 ACCOUNT_PURGED`; the irreversible financial cutoff is never reopened.
- Purge workers use row locks or leases so only one worker processes a request. In the global lock order, purge locks `User` then `FinancialSubject`, atomically sets `FinancialSubject.benefitsDisabledAt`, removes the active-user link, and only then deletes external identities, readings, preferences, account cache metadata, device/session data, and other personal application data.
- Commerce rows reference a separate random internal `FinancialSubject`, not a deletion-sensitive user foreign key. Purge removes its login/profile linkage and the encrypted raw `appAccountToken`, retaining only minimized transactions, credit events, notifications, reconciliation facts, and a versioned one-way token digest where future Apple routing requires it. None can restore the deleted profile.
- Unfinished deliveries, renewals, and refunds received after purge are retained as financial events and grant no benefit to the purged account. They are never silently transferred to a recreated player.
- After purge, the same Apple subject creates a new user, financial subject, and purchase token. Old readings, credits, financial state, and subscription benefit never transfer or restore. Apple may continue billing the old subscription until separately cancelled even though the new account receives no Oracle+ benefit; the deletion UI states this and links to Manage Subscription.
- The base free experience is never conditioned on withdrawing a deletion request.

---

## 7. StoreKit and entitlement architecture

### 7.1 App Store products

Final bundle ID and product IDs are immutable launch decisions. Proposed IDs:

| Product | Type | Proposed product ID | Server grant |
| --- | --- | --- | --- |
| 10 Fortune Pack | Consumable | `app.fortuneness.fortunepack10` | One 10-unit `PackCreditGrant` exactly once per environment + transaction ID |
| Oracle+ Monthly | Auto-renewable subscription | `app.fortuneness.oracleplus.monthly` | Up to 10 subscription-source draws per eligible allowance period while entitled |

The owner chooses App Store price tiers before TestFlight commerce testing. UI always uses localized StoreKit metadata. The monthly product is configured and validated as the intended standard pay-as-you-go `billingPlanType`, never a 12-month commitment plan. Billing Grace Period is enabled in App Store Connect for Sandbox and Production using the owner-approved duration; `GRACE_PERIOD` benefits exist only when verified Apple data includes a future grace expiration.

### 7.2 Client transaction flow

1. Start the `Transaction.updates` listener at application launch before authentication/bootstrap work and keep it alive for the process lifetime. Buffer verified delivery work until an account/bootstrap decision is available.
2. Load products from StoreKit 2, render StoreKit-provided price/period data, and check `AppStore.canMakePayments`/equivalent before enabling purchase initiation.
3. Purchase with the authenticated financial subject's current server-issued purchase token as `appAccountToken`; keep it only in account-scoped memory/Keychain, clear it on player change/logout/deletion, and never expose or reuse the internal financial-subject ID for this purpose.
4. Accept only StoreKit-verified transactions on device and send the signed JWS representation to `/v1/iap/transactions`.
5. The server verifies ownership and runs the atomic application procedure in section 7.3. A duplicate accepted delivery is normal success with `appliedNow: false`.
6. Call `transaction.finish()` only after HTTP `200` with `deliveryAccepted: true` and `safeToFinish: true`. Verification failure, unknown ownership, and retryable server failure remain unfinished.
7. After bootstrap, enumerate `Transaction.unfinished` and `Transaction.currentEntitlements` and reconcile them without prompting. Normal launch never calls `AppStore.sync()`.
8. Only an explicit player-tapped **Restore Purchases** action calls `AppStore.sync()`, then re-enumerates current entitlements and unfinished transactions.
9. Killing the app at any step is harmless: the listener, unfinished enumeration, `ONE_TIME_CHARGE`, and server reconciliation all call the same idempotent application service.

### 7.3 Server verification

The API uses Apple's App Store Server Library or an equivalently complete implementation to verify signed transactions and renewal information.

Validate at minimum:

- JWS signature and Apple certificate chain.
- Bundle ID.
- App Apple ID where applicable.
- Product ID, product type, and configured subscription `billingPlanType` against the allowlist.
- Environment against the receiving environment.
- Resolve immutable ownership in this order: an existing `(environment, transactionId)` owner; for subscriptions, an existing `(environment, originalTransactionId)` owner; otherwise a known nonnil `appAccountToken` binding. Any nonnil token must agree with business-key ownership; a conflict is quarantined, alerted, and returned only as privacy-safe `TRANSACTION_OWNER_UNKNOWN`. Quarantine for missing ownership only when neither an existing business key nor a known token identifies an owner; a nil token on a known renewal/duplicate is accepted for that recorded owner.
- Transaction identity uniqueness by `(environment, transactionId)` and subscription ownership uniqueness by `(environment, originalTransactionId)`.
- Purchase, expiration, revocation, ownership, and offer fields.

Persist decoded fields needed for audit/reconciliation. Avoid logging or repeatedly storing full JWS data when a hash plus normalized verified payload is sufficient. An encrypted original server-notification payload may be retained for 90 days solely for replay/debugging of unknown or failed event types, then deleted while its hash and normalized facts remain.

#### Atomic transaction application

Every verified transaction received from the client, `ONE_TIME_CHARGE`, another notification, or reconciliation passes through one service:

1. Verify JWS and normalized Apple fields before opening the database transaction.
2. Acquire a transaction-scoped lock keyed by environment + transaction ID for consumables, or environment + original transaction ID for subscriptions.
3. Under the business-key lock, resolve ownership using the hierarchy above, fail closed on a nonnil-token conflict, then lock the `FinancialSubject`. Authenticated caller identity never overrides the recorded owner. If no owner is identifiable, quarantine; if `benefitsDisabledAt` is set, record terminal `OWNER_CLOSED_NO_BENEFIT` and do not create or change a grant/entitlement benefit.
4. Upsert `IapTransaction` by `(environment, transactionId)`. Existing immutable fields must match; a conflict fails closed.
5. Apply or recompute the pack grant/refund or subscription entitlement using the rules below.
6. Mark the transaction `APPLIED` or `QUARANTINED`, with its converged benefit/refund disposition and `appliedAt` where applicable.
7. Commit the transaction row, grant/ledger change, entitlement change, and disposition together before returning `deliveryAccepted: true`.

A crash cannot leave a transaction permanently “seen” without its benefit or terminal no-benefit disposition. New and duplicate accepted deliveries return HTTP `200`; duplicate success returns `appliedNow: false` and `safeToFinish: true`. Commerce responses are a discriminated union: `callerState` may describe only the authenticated caller and is never populated from another owner. A known closed owner records internal `OWNER_CLOSED_NO_BENEFIT` and is safe to finish, but an authenticated different player sees only `DELIVERED_TO_OTHER_ACCOUNT` with no owner state. Retryable lock/database failure returns `503 RETRYABLE_CONFLICT`, and the client leaves the StoreKit transaction unfinished.

### 7.4 App Store Server Notifications V2

- Expose a dedicated unauthenticated HTTPS endpoint such as `/v1/webhooks/app-store`.
- Verify the outer notification JWS before reading it, then independently verify nested transaction and renewal JWS. Deduplicate transport by `notificationUUID` and business effects by Apple transaction/original-transaction keys.
- Persist the verified envelope durably before returning success. Database-backed workers claim pending rows with leases/row locks; repeated workers are harmless.
- Handle explicit V2 types relevant to V1: `ONE_TIME_CHARGE`, `SUBSCRIBED`, `DID_RENEW`, `DID_FAIL_TO_RENEW`, `GRACE_PERIOD_EXPIRED`, `EXPIRED`, `REVOKE`, `DID_CHANGE_RENEWAL_PREF`, `DID_CHANGE_RENEWAL_STATUS`, `REFUND`, `REFUND_REVERSED`, `REFUND_DECLINED`, `CONSUMPTION_REQUEST`, and `TEST`.
- `ONE_TIME_CHARGE` invokes atomic transaction application and can grant the pack even if the client never returns. Missing/unknown ownership is quarantined, not granted or discarded.
- Route `REFUND` and `REFUND_REVERSED` by verified product and type. For a Fortune Pack, converge the grant's refunded-unit target using section 7.5. For Oracle+, record the refund or reversal and recompute entitlement from verified transaction, renewal, and Subscription Status facts; never apply pack-unit logic to a subscription. `REFUND_DECLINED` changes no benefit, and no refund event deletes archived readings.
- The implementation supports explicit, versioned, revocable consent for sharing minimized consumption information for eligible Fortune Pack and Oracle+ refund requests. The deployment flag and player consent both default off and consent is never inferred from purchase; when the flag is disabled, the setting is hidden and no information is sent. On `CONSUMPTION_REQUEST`, persist immediately; only when the flag is enabled and valid consent exists, call **Send Consumption Information** within 12 hours with accurate `customerConsented`. Build the payload by product type, never send `consumptionPercentage` for an auto-renewable subscription because Apple calculates it, and never include fortune text, card history, or raw Apple identity. Otherwise send nothing and safely acknowledge/store the request. Reflect this processing in App Privacy disclosures.
- Unknown future types retain encrypted payload for the bounded replay period and are acknowledged safely rather than crashing. Adding support replays the stored envelope through the same reducer.
- Scheduled reconciliation uses App Store Server API Transaction History V2 and Subscription Status. It uses the same application/reduction paths and a distributed job lock.

#### Monotonic subscription reduction

- Each verified subscription transaction retains Apple's raw `expiresAt`. `SubscriptionEntitlement.paidThrough` is the canonical aggregate access cutoff derived as the greatest eligible unrevoked `expiresAt` for that immutable owner; API state and draw logic never use a second aggregate expiry name.
- Store every verified subscription transaction and renewal fact independently. Never derive state from notification arrival order.
- Serialize recomputation by `(environment, originalTransactionId)`. Older events may fill history but may not erase a later expiration, revocation, ownership change, or paid-through date. `lastAppleEventTime` is the greatest verified source time, not receipt time; equal-time conflicts use authoritative reconciliation/corrective-event precedence plus a stable source-ID tie-breaker.
- Revocation/refund facts remain effective unless a later verified `REFUND_REVERSED` event or newer authoritative reconciliation explicitly supersedes them.
- Derive status using server time: `ACTIVE` when aggregate `paidThrough > now`; `GRACE_PERIOD` only when no active paid period exists and verified `graceThrough > now`; `BILLING_RETRY` for verified retry without active grace; `REVOKED` for effective revocation without a later eligible period; otherwise `EXPIRED`.
- Auto-renew preference never grants or removes access before verified `paidThrough`. Every draw evaluates canonical `paidThrough`, `graceThrough`, and revocation timestamps inside its transaction; a stale `ACTIVE` enum cannot grant a draw.

### 7.5 Credit ledger

Pack credits use append-only ledger entries allocated to immutable 10-unit purchase grants. For an open financial subject, spendable balance never becomes negative. For a subject with `benefitsDisabledAt`, spendable balance is defined as zero regardless of retained historical ledger rows. A later independently accepted pack for an open subject initially contributes 10 spendable units and is affected only by its own verified refund state, never by unrecovered units from an earlier purchase.

Ledger reasons are `PACK_PURCHASE`, `FORTUNE_DRAW`, `REFUND_DEBIT`, `REFUND_REINSTATEMENT`, `SUPPORT_ADJUSTMENT`, and `MIGRATION`.

- Every verified pack purchase owned by an open financial subject creates exactly one immutable `PackCreditGrant` and one `PACK_PURCHASE +10` entry, even when its refund notification arrived first; the same atomic reducer immediately applies the current refund target. A closed owner receives only the terminal no-benefit transaction disposition.
- Each pack-funded draw allocates FIFO from a grant with remaining units and creates exactly one `FORTUNE_DRAW -1` entry linked to both draw and grant.
- Apple expresses `revocationPercentage` in milliunits. Let `r = clamp(revocationPercentage ?? 100000, 0, 100000)` and compute `targetRefundedUnits = roundHalfUp(10 × r / 100000)`.
- Persist each verified refund/reversal fact with its Apple source time, source kind, and stable source identity. Under the financial-subject lock, reduce by deterministic tuple `(sourceTime, authorityRank, eventTypePrecedence, sourceId)`: newer source time wins; at equal time, authoritative reconciliation outranks a notification and `REFUND_REVERSED` outranks `REFUND`; the stable ID breaks any remaining tie. Older facts are audit-only and exact duplicates are no-ops.
- Converge the grant to that target using compensating `REFUND_DEBIT`/`REFUND_REINSTATEMENT` entries. Debit at most its currently unspent units and record any consumed target portion as `unrecoveredRefundUnits`; this is an audit/fraud signal, not negative player debt.
- A newer reversal sets the current refund target and current unrecovered count to zero and reinstates only units actually removed; historical refund facts remain auditable. A full refund-before-delivery therefore leaves zero spendable units, a partial refund leaves the unrefunded units, and a later `REFUND_REVERSED` materializes exactly the original units previously removed. Repeated and out-of-order input is harmless, and consumed units are never duplicated.
- A pack refund never removes the free allowance, subscription allowance, or archived reading.
- All grant, draw, refund, reconcile, migration, and support-adjustment writers lock the same stable `FinancialSubject` row. Separate uniqueness constraints enforce one purchase grant per transaction, one debit per draw, and one converged refund disposition per grant.
- API `spendablePackCredits` is the nonnegative ledger sum. Internal `unrecoveredRefundUnits` is never displayed as a balance and never absorbs a later purchase. Repeated abuse may set `commerceReviewRequired` and block purchase initiation with a support path.
- Application-role database permissions prohibit UPDATE/DELETE of ledger rows. Support adjustments require a reason, authenticated actor, and audit event.

### 7.6 Account mismatch

Sign in with Apple identity and App Store purchase identity remain separate trust domains. `appAccountToken` is optional in Apple data; retain its binding history. A transaction belongs immutably to the financial subject identified by its known token.

- For every immediate or delayed client delivery, `updates`, `unfinished`, or `ONE_TIME_CHARGE`, route a known owner correctly. If that owner is the active player, return the normal disposition with optional `callerState`; otherwise return privacy-safe `DELIVERED_TO_OTHER_ACCOUNT`, `deliveryAccepted: true`, and `safeToFinish: true`, omitting owner state and all owner data.
- A nil/unknown token is quarantined only when transaction/original-transaction business keys also have no recorded owner. Do not discard, grant, or finish that unowned transaction until a documented claim/support process verifies ownership; nil-token renewals and duplicates with known business-key ownership continue normally.
- If StoreKit exposes an entitlement belonging to another player, explain the mismatch and ask the player to switch back or contact support. Never grant one consumable transaction or original subscription to two financial subjects.
- V1 never transfers a consumable grant, subscription, transaction, or financial-subject ownership between accounts. Support may rotate or repair a token binding only for the same verified financial subject, using Apple's current Set App Account Token API where applicable and preserving effective-dated token history. Purged-account financial events and benefits are never transferable.

---

## 8. Database specification

The Prisma schema is canonical at `apps/api/prisma/schema.prisma`. Migrations are checked in and deployed with `prisma migrate deploy`; production never uses `db push`.

### 8.1 Core models

| Model | Purpose and key constraints |
| --- | --- |
| `User` | UUID ID, status, `sessionVersion`, resolved locale, current/pending IANA zones and effective/change-eligible timestamps, onboarding/settings, optional active financial-subject link, created/updated/deleted timestamps. |
| `ExternalIdentity` | Provider, user, key version, unique subject digest, optional secondary migration digest, last-authenticated time; no raw identifier. Supports the Phase 0 provider decision without changing account ownership tables. |
| `SessionFamily` | User, `identityAuthenticatedAt`, issued/expiry/revocation times and reason. Every access token names one active family and carries matching immutable `auth_time`. |
| `RefreshToken` | Hashed rotating token, family, unique predecessor/replacement links, consumed/expiry times, request hash, idempotency key, device metadata. |
| `RefreshReplayReceipt` | Refresh idempotency key, encrypted replacement response, key version, and expiry no later than 120 seconds. |
| `IdempotencyRecord` | Mutation actor, method, normalized route, UUID key, request hash, terminal outcome/status, result reference or bounded response snapshot, and created/retention timestamps. Draw records live for the account lifetime; personal records cascade on purge. |
| `FinancialSubject` | Random internal UUID that stably owns IAP/credit rows and is never sent to Apple; optional `benefitsDisabledAt` is an irreversible terminal benefit cutoff. Its personal-user link is removed on purge while minimized Apple facts remain. |
| `AppAccountTokenBinding` | Separate random purchase-token UUID, versioned HMAC digest, encrypted raw value while recoverable, financial subject, valid-from/to and crypto-erasure timestamps, reason, and audited same-owner rotation/repair metadata. Ownership history is immutable; purge erases the raw value while retaining only the digest when required. |
| `TarotCard` | Stable key, English display number/name, arcana, optional suit/rank, asset key, localized human-reviewed alt text, sort order, active flag. |
| `FortuneTemplate` | Card, locale, orientation, intention, variant, headline, message, action, affirmation, content version, active flag. Unique logical content key. |
| `FortuneDraw` | UUID, user, card/template, allowance-period ID, allowance source, intention/orientation/resolved locale, sequence, immutable text/card/alt/content-version snapshot, issued/viewed times, client idempotency key and request hash. |
| `AllowancePeriod` | Monotonic per-user sequence/UUID, UTC start/reset boundaries, time-zone snapshot. Periods cannot overlap and are not identified only by a reusable local date. |
| `AllowanceUsage` | Unique allowance-period ID, user, `freeUsed`, and `subscriptionUsed`. Check constraints cap free at 1 and subscription at 10. |
| `PackCreditGrant` | Financial subject, unique purchase transaction, `originalUnits = 10`, drawn units, current refund target, currently refunded-unspent and unrecovered units, greatest applied refund source time/identity/type, and disposition. |
| `CreditLedgerEntry` | Financial subject, signed delta, balance after, reason, linked grant/purchase/draw, verified refund source identity where applicable, created time. Unique links prevent duplicate grants, draw debits, and refund effects. |
| `IapTransaction` | Environment + Apple transaction ID, original transaction ID, product/type and subscription `billingPlanType` where applicable, immutable financial-subject owner, token-binding reference, purchase time/raw `expiresAt`/revocation/refund fields, application status/disposition/applied time, normalized payload, JWS hash. |
| `SubscriptionEntitlement` | Unique environment + original transaction ID with immutable financial-subject owner, normalized status, canonical aggregate `paidThrough`, `graceThrough`, revocation and auto-renew facts, greatest verified Apple source time. |
| `AppStoreNotification` | Unique notification UUID, type/subtype/environment, payload hash, encrypted payload with deletion deadline, processing status/lease/attempts/error, source and receipt timestamps. |
| `ConsumptionConsent` | Financial subject, policy version, eligible product-type scope, granted/revoked timestamps, and minimized audit proof. Default absent/off and never inferred from purchase. |
| `AccountDeletionRequest` | User, request/purge/cancel timestamps, status. One active request per user. |
| `AuditEvent` | Actor type, actor ID where applicable, action, target, minimized metadata, timestamp. No fortune text or auth secrets in metadata. |

### 8.2 Important enums

- `UserStatus`: `ACTIVE`, `DELETION_PENDING`, `PURGED`, `BLOCKED`.
- `ExternalIdentityProvider`: `SIGN_IN_WITH_APPLE`; `GAME_CENTER` remains only as a legacy database enum value during migration.
- `Arcana`: `MAJOR`, `MINOR`.
- `TarotSuit`: `WANDS`, `CUPS`, `SWORDS`, `PENTACLES`.
- `Orientation`: `UPRIGHT`, `REVERSED`.
- `FortuneIntention`: `GENERAL`, `LOVE`, `WORK`, `GROWTH`.
- `AllowanceSource`: `FREE_DAILY`, `SUBSCRIPTION_DAILY`, `PACK_CREDIT`.
- `IapEnvironment`: `SANDBOX`, `PRODUCTION`, `XCODE` where supported.
- `SubscriptionStatus`: `ACTIVE`, `GRACE_PERIOD`, `BILLING_RETRY`, `EXPIRED`, `REVOKED`.
- `IapApplicationStatus`: `RECEIVED`, `APPLIED`, `QUARANTINED`.
- `LedgerReason`: values listed in section 7.5.

### 8.3 Database integrity

- Unique `(actorType, actorId, method, normalizedRoute, key)` on `IdempotencyRecord`; the stored request hash is required. Unique `(userId, clientIdempotencyKey)` remains on `FortuneDraw` as a domain audit constraint.
- Partial unique index allowing at most one `FortuneDraw` with `viewedAt IS NULL` per user.
- Unique `(userId, sequence)` and `(userId, id)` plus nonoverlapping half-open UTC ranges on `AllowancePeriod`; the accepted time-zone transition updates the current period's one `resetAt` rather than inserting an intermediate range.
- Composite `(userId, allowancePeriodId)` foreign keys from `FortuneDraw` and `AllowanceUsage` reference `AllowancePeriod(userId, id)` so a period cannot be attached to another user; `AllowanceUsage` remains unique per period.
- Unique `(environment, transactionId)` on IAP rows and `(environment, originalTransactionId)` on subscription ownership.
- Unique versioned app-account-token digest, and at most one current recoverable purchase-token binding per active financial subject.
- Unique App Store `notificationUUID`.
- Unique credit grant per purchase transaction, unique credit debit per draw, and unique applied refund-source effects per grant.
- Check `freeUsed BETWEEN 0 AND 1` and `subscriptionUsed BETWEEN 0 AND 10`.
- Check each pack grant has `originalUnits = 10`; all counters are between 0 and 10; `drawnUnits + currentRefundedUnspentUnits <= 10`; `currentUnrecoveredRefundUnits <= drawnUnits`; and `currentRefundTargetUnits = currentRefundedUnspentUnits + currentUnrecoveredRefundUnits`. Transaction tests/triggers prove remaining grant units equal the linked ledger net.
- Check a persisted Apple `revocationPercentage` is an integer between `0` and `100000`; never store it as percentage points or a binary floating-point value.
- Check ledger reason/delta/link combinations: purchase is `+10`, draw is `-1`, refund debit is `-1..-10`, and reinstatement is `+1..+10`. Transaction code prevents a negative financial-subject balance.
- Every financial benefit writer locks `FinancialSubject` and rejects benefit mutation when `benefitsDisabledAt` is set; the cutoff is irreversible by database constraint/privilege and closed-subject spendable balance is zero.
- Check card/template required fields and valid Minor Arcana suit/rank combinations in application validation plus migration SQL where practical.
- Index reading history `(userId, issuedAt DESC, id DESC)`.
- Index collection lookup `(userId, cardId, issuedAt)`.
- Index subscription reconciliation by `(status, paidThrough)`; raw per-transaction `expiresAt` is indexed separately only where history queries require it.
- Define explicit foreign-key deletion behavior: personal rows cascade during purge; financial rows restrict deletion or retain `FinancialSubject`; optional links to purged draws use `SET NULL` while immutable audit references remain.
- Deny UPDATE/DELETE on credit-ledger rows to the application database role; correction is a compensating entry.

### 8.4 Atomic draw transaction

Use PostgreSQL `READ COMMITTED` with a stable `User` row lock. All user-scoped allowance, time-zone, deletion, and draw writers use that lock; when both user and financial subject are needed, lock them in that order.

1. Validate the `Idempotency-Key`, canonicalize the request, and compute its request hash.
2. Begin and lock the `User` row before looking up the idempotency key.
3. Recheck `ACTIVE`, access-token `sessionVersion`, and active session family.
4. Find the actor/method/route/key `IdempotencyRecord`. Equal request hash replays its stable domain result; a different hash returns `409 IDEMPOTENCY_KEY_REUSED`.
5. If another unviewed draw exists, insert a terminal conflict record referring to that owned draw, commit, and return `409 UNVIEWED_READING_PENDING`; consume nothing.
6. Lock the financial subject, activate any due pending time-zone change, and resolve the current monotonic allowance period.
7. Recompute verified entitlement timestamps and spendable pack balance, then select allowance in required priority order.
8. If none exists, insert a terminal conflict record with the authoritative state snapshot, commit, and return `409 NO_DRAWS_AVAILABLE`.
9. Select content using section 2.5 and insert the immutable draw, key, request hash, and complete snapshot.
10. Increment period usage or allocate/append the unique `-1` grant debit.
11. Insert the successful idempotency record pointing to the draw and committed issuance result.
12. Commit.

Wrap lock/deadlock failures in at most five retries with jittered exponential backoff capped at 200 ms. Exhaustion returns `503 RETRYABLE_CONFLICT`; the client retries with the same key. If an idempotency/draw unique constraint still wins a race, roll back, load the committed idempotency record in a new transaction, compare its request hash, and replay its result. A failure consumes nothing.

---

## 9. API surface

| Method and route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | No | Process and database readiness. No secrets or dependency internals. |
| `POST /v1/auth/apple` | Apple identity token plus nonce | Verify identity; create/find user or perform recent reauthentication; return a session with authoritative `auth_time` and bootstrap state. |
| `POST /v1/auth/refresh` | Refresh token + `Idempotency-Key` | Rotate token family and return one replacement session. |
| `POST /v1/auth/logout` | Session | Revoke current refresh family. |
| `GET /v1/me` | Access token | Profile, settings, account status, server time. |
| `PATCH /v1/me/preferences` | Access token | Reminder, sound, haptic, motion, and requested time-zone preferences. V1 locale is read-only and resolved from reported device locale during authentication/bootstrap. |
| `DELETE /v1/me` | Access token with `auth_time` ≤ 300 seconds + confirmations | Begin account deletion and revoke normal sessions on commit. |
| `GET /v1/me/deletion` | Deletion-management token | Return pending deletion status and dates. |
| `POST /v1/me/deletion/cancel` | Deletion-management token | Cancel pending deletion before purge wins the lock. |
| `GET /v1/fortune/state` | Access token | Current allowances, balance, subscription state, latest/resumable reading, next reset. |
| `POST /v1/fortunes/draw` | Access token + idempotency | Atomically issue one fortune for an intention. |
| `GET /v1/fortunes` | Access token | Cursor-paginated immutable reading archive and filters. |
| `GET /v1/fortunes/:id` | Access token | One owned reading. |
| `PATCH /v1/fortunes/:id/viewed` | Access token | Idempotently mark reveal as viewed. |
| `GET /v1/collection` | Access token | 78-card unlock/discovery summary. |
| `GET /v1/collection/cards/:key` | Access token | Card metadata plus cursor-paginated owned readings. |
| `GET /v1/iap/catalog` | Access token | Allowed product IDs and server-owned benefit copy; StoreKit supplies price. |
| `POST /v1/iap/transactions` | Access token | Verify and idempotently apply signed StoreKit transaction. |
| `POST /v1/iap/reconcile` | Access token | Reconcile signed current/unfinished transactions sent by the client. |
| `GET /v1/iap/status` | Access token | Normalized entitlement and pack balance. |
| `POST /v1/webhooks/app-store` | Signed Apple JWS | App Store Server Notifications V2 receiver. |

### 9.1 Draw request example

```http
POST /v1/fortunes/draw
Idempotency-Key: cce93010-158e-4d65-bdd8-38672203a59b
Content-Type: application/json
```

```json
{
  "intention": "GROWTH"
}
```

### 9.2 Draw response shape

```json
{
  "draw": {
    "id": "uuid",
    "cardKey": "major-00-fool",
    "cardName": "The Fool",
    "orientation": "UPRIGHT",
    "intention": "GROWTH",
    "resolvedLocale": "en",
    "artAltText": "A traveler steps toward dawn beneath a bright wandering star.",
    "headline": "Begin before certainty arrives",
    "message": "...",
    "action": "Choose one small beginning and give it ten honest minutes.",
    "affirmation": "I can meet the unknown with curiosity.",
    "allowanceSource": "FREE_DAILY",
    "issuedAt": "2026-08-05T14:30:00.000Z"
  },
  "state": {
    "freeRemaining": 0,
    "subscriptionRemaining": 0,
    "spendablePackCredits": 10,
    "allowancePeriodId": "uuid",
    "currentPeriodStartedAt": "2026-08-04T21:00:00.000Z",
    "nextResetAt": "2026-08-05T21:00:00.000Z"
  }
}
```

### 9.3 Stable error codes

`retryable` means the operation may succeed after the stated condition changes. `sameKeyRetrySafe` means resending a keyed route with the identical canonical request cannot create a second mutation; for a stored terminal draw outcome it only replays that outcome.

| Code | HTTP/source | Retryable | Same key safe | Required details / next action |
| --- | --- | --- | --- | --- |
| `VALIDATION_FAILED` | `400` | No | No | Typed field issues; correct the request. |
| `AUTH_REQUIRED` | `401` | Yes | Yes on keyed route | Reauthenticate; no idempotency record was reserved. |
| `APPLE_ID_REAUTH_REQUIRED` | `401` | Yes | No | Complete a new Apple sign-in; deletion requires `auth_time` ≤ 300 seconds. |
| `APPLE_ID_UNAVAILABLE` | Client-local or `503` | Yes | No | Retry after Apple authentication/JWKS recovery. |
| `APPLE_ID_TOKEN_INVALID` | `401` | No | No | Obtain a new token; alert on repeated server-side failures. |
| `APPLE_ID_TOKEN_EXPIRED` | `401` | Yes | No | Obtain a fresh identity token. |
| `ACCOUNT_DELETION_PENDING` | `423` | No | No | Deletion status/cancellation path only. |
| `ACCOUNT_PURGED` | `410` | No | No | Create a new empty account through normal authentication. |
| `NOT_FOUND` | `404` | No | No | Includes unauthorized owned-resource lookup. |
| `NO_DRAWS_AVAILABLE` | `409` | No | Yes | Stored terminal result with authoritative state and `nextResetAt`; use a new key after state changes. |
| `UNVIEWED_READING_PENDING` | `409` | No | Yes | Stored terminal result with the owned draw; acknowledge it, then use a new draw key. |
| `NETWORK_REQUIRED` | Client-local | Yes | Yes if never sent | Wait for connectivity; draws/commerce are not queued as new mutations. |
| `CONTENT_UNAVAILABLE` | `503` | Yes | Yes | No allowance consumed and no key reserved; honor `retryAfter`. |
| `PRODUCT_NOT_ALLOWED` | `400` | No | No | Refresh the allowlisted catalog/app version. |
| `TRANSACTION_UNVERIFIED` | `400` | No | No | Do not finish; reacquire an authentic StoreKit verification result. |
| `TRANSACTION_OWNER_UNKNOWN` | `409` | Yes after resolution | Yes by Apple business key | Quarantined with privacy-safe support path; do not finish. |
| `TRANSACTION_PENDING` | Client-local | Yes | Yes by Apple business key | Await StoreKit approval/state change; grant nothing. |
| `COMMERCE_REVIEW_REQUIRED` | `423` | Yes after support review | No | Block new pack initiation only; preserve free/subscription allowances. |
| `IDEMPOTENCY_KEY_REUSED` | `409` | No | No | The key belongs to different input; generate a new UUID only for a deliberate new operation. |
| `TIME_ZONE_CHANGE_LIMITED` | `409` | Yes after time | No | Return `nextEligibleAt`, pending/current zones, and support path. |
| `RETRYABLE_CONFLICT` | `503` | Yes | Yes | Retry after jitter/backoff with the identical key and body. |
| `RATE_LIMITED` | `429` | Yes | Yes on keyed route | Honor `retryAfter`; no mutation/key reservation occurred. |
| `INTERNAL_ERROR` | `500` | Yes | Yes on keyed route | Retry with the same key; alert with `requestId`. |

An already-applied purchase is successful idempotent delivery, never an error. `DELIVERED_TO_OTHER_ACCOUNT` is a privacy-safe successful commerce disposition, not an authorization error.

### 9.4 Canonical route contracts

The Zod schemas in `packages/api-contracts` and generated OpenAPI document are release artifacts. CI fails when implementation, examples, and OpenAPI drift. Unknown request properties are rejected; response schemas strip internal fields.

| Route | Canonical request/query | Success contract |
| --- | --- | --- |
| `GET /health` | None | `200 { status, database, requestId }`; no version or dependency secrets. |
| `POST /v1/auth/apple` | Identity token, nonce, and allowlisted/canonicalized reported device locale/time zone from section 6.1 | `200 { user, session, bootstrap }`; pending deletion returns `423` plus deletion-management exchange data, never a normal session. |
| `POST /v1/auth/refresh` | Refresh token plus header key | `200 { accessToken, refreshToken, expiresAt }`; exact retry returns the same replacement during the replay window. |
| `POST /v1/auth/logout` | Current active family | `204`; a repeated call with the revoked family is `401`. |
| `GET /v1/me` | None | `200 { user, preferences, accountStatus, timeZoneState, serverTime }`. |
| `PATCH /v1/me/preferences` | Partial allowlisted reminder/sound/haptic/motion preferences; requested canonical zone | `200 { preferences, timeZoneState }`; V1 rejects locale writes, and an accepted zone change is represented as pending state. |
| `DELETE /v1/me` | Confirmation version and applicable acknowledgements; access session must have authoritative `auth_time` ≤ 300 seconds | `202 { deletion: { status, requestedAt, purgeAt } }` after immediate normal-session revocation; a lost-response retry with the revoked session is `423`. |
| `GET /v1/me/deletion` | None | `200 { status, requestedAt, purgeAt, cancelledAt? }`. |
| `POST /v1/me/deletion/cancel` | None | `200 { user, session, bootstrap }`; `410 ACCOUNT_PURGED` after purge. |
| `GET /v1/fortune/state` | None | `200 { state, unviewedDraw? }` with server time and all absolute period/time-zone timestamps. |
| `POST /v1/fortunes/draw` | `{ intention }` plus header key | First issuance `201`; same-key replay `200`; an existing unviewed draw or exhausted allowance is `409` with owned authoritative state. |
| `GET /v1/fortunes` | `cursor`, `limit`, and allowlisted filters | `200 { items, nextCursor, syncedAt }`. |
| `GET /v1/fortunes/:id` | Owned UUID | `200 { draw }`; another user's ID is indistinguishable from not found. |
| `PATCH /v1/fortunes/:id/viewed` | None | `200 { draw }`; repeated acknowledgement is identical. |
| `GET /v1/collection` | None | `200 { cards, unlockedCount, totalCount, syncedAt }`. |
| `GET /v1/collection/cards/:key` | `cursor`, `limit` | `200 { card, readings, nextCursor, syncedAt }`. |
| `GET /v1/iap/catalog` | None | `200 { products, benefits, gracePeriodPolicy, appAccountToken }`; the token is the current server-issued purchase token, while price remains StoreKit-owned. |
| `POST /v1/iap/transactions` | `{ signedTransaction }` | Discriminated `200 { transactionId, deliveryAccepted, safeToFinish, appliedNow, disposition, callerState? }`; `callerState` is omitted for other/closed-owner delivery and can never describe the recorded other owner. |
| `POST /v1/iap/reconcile` | Up to 100 signed current/unfinished items | `200 { dispositions, callerState? }`; each item is independently idempotent, and the optional state belongs only to the authenticated caller. |
| `GET /v1/iap/status` | None | `200 { subscription, spendablePackCredits, commerceReviewRequired }`. |
| `POST /v1/webhooks/app-store` | Raw signed V2 body, bounded size | `200` only after durable verified-envelope persistence; verification/storage failure returns retryable non-2xx. |

Pagination defaults to 30 and caps at 100. Cursors are opaque, signed or server-random, and bound to user, filters, and stable `(issuedAt DESC, id DESC)` order; malformed or mismatched cursors return `400`. Request bodies and batches have explicit byte/item limits.

Status rules are fixed: validation `400`; unauthenticated/stale-required-auth `401`; unauthorized owned resource as `404`; deletion-pending or commerce-review lock `423`; new draw `201`; idempotent replay/read/accepted commerce `200`; deletion request `202`; terminal business/idempotency/unknown-owner conflict `409`; purged `410`; rate limit `429`; retryable service/lock failure `503`. Every error follows section 5.4 and the complete mapping in section 9.3.

---

## 10. Content and Google ADC asset pipeline

### 10.1 Card art rules

Use the `google-adc-imagegen` workflow during implementation. The prompt system must request:

- Original nocturnal Art Nouveau/celestial imagery for Fortuneness.
- Consistent composition, lighting, palette, visual density, and symbolic language across all 78 cards.
- Inclusive human representation without sexualized, graphic, or frightening content.
- No imitation of a named living artist.
- No readable text, letters, numbers, logos, watermarks, or finished card borders.
- A clear central subject with safe crop margins for 2:3 portrait presentation.

Card names, numbers, suit symbols, frames, rarity-free state, locks, and progress are code-rendered. Generated images are illustration layers, not screenshots of the final UI.

### 10.2 Prompt manifest

`tools/card-assets/manifest.json` records for every card:

- stable card key;
- symbolic brief and prohibited elements;
- prompt template version;
- generation model/workflow version;
- source output path and checksum;
- crop/normalization version;
- `localizedAltText` for every launch locale; English descriptions are 8–25 words, describe visible imagery without divination claims, and receive human editorial review;
- review status and notes.

Generate a three-card vertical slice first: one Major Arcana, one court card, and one pip card. Lock the style only after all three work in the coded frame on iPhone and iPad.

### 10.3 Asset normalization

- Master output: lossless archival image at a consistent portrait ratio.
- Shipping output: optimized format supported by the selected Expo image stack, with a PNG fallback only when alpha is required.
- Target shipping illustration size: approximately 1024 × 1536 px; adjust after real-device memory testing.
- Remove metadata not required at runtime.
- Asset checks fail CI for wrong dimensions, excessive file size, missing manifest entry, duplicate checksum, or missing card key.
- Use perceptual-duplicate inspection to catch different files with substantially identical composition.
- Bundle the launch deck so a revealed card never depends on a CDN image request.

### 10.4 Fortune content

V1 English (`en`) minimum catalog:

- 78 cards.
- Upright and reversed meaning for every card.
- General, Love, Work, and Growth intentions.
- At least one fully reviewed variant for each combination: 78 × 2 × 4 = 624 fortune templates.
- Target two variants per combination before launch if editorial capacity allows: 1,248 templates.

Every template contains a headline, message, gentle action, and affirmation. A content validator enforces supported locale, length, missing combinations, duplicate copy, banned absolute/harmful phrasing, valid card references, and complete localized card-name/alt-text coverage. Adding a launch locale multiplies the required template matrix and is impossible without a complete validated seed. Historical snapshots remain in their resolved issuance locale.

Content guidance:

- Use possibility language: “may,” “invites,” “consider,” and “notice.”
- Avoid guaranteed outcomes, exact dates, claims about another person's hidden thoughts, or commands to make consequential decisions.
- Never advise stopping medication, leaving safety, spending/investing money, or treating a reading as evidence.
- Reversed readings represent blocked, inward, delayed, or reconsidered energy—not punishment or doom.

---

## 11. Privacy, safety, observability, and operations

### 11.1 Data minimization

Collect only what V1 uses:

- Versioned pseudonymized Apple subject digests and bounded identity-token replay fingerprints.
- Time zone, locale, preferences, sessions/devices, readings, purchase/entitlement metadata, optional versioned consumption-consent state, and operational logs.
- A random internal financial subject plus an encrypted raw purchase token and versioned lookup digest while the account is active; after personal-account purge, erase the raw token and retain only the closed subject and minimized digest where future Apple reconciliation requires them.

Do not collect precise location, contacts, photos, microphone, health data, advertising ID, cross-app tracking data, or social graph. Do not request permissions without an active feature that needs them.

Retention defaults are explicit: proof-replay fingerprints expire 10 minutes after the maximum accepted proof age; IP/identity rate-limit hashes expire within 7 days; ordinary production application logs expire within 30 days; encrypted raw App Store notification envelopes expire within 90 days. Financial/audit retention and backup expiry are documented in the Privacy Policy using the legally approved period. A restore runbook reapplies completed-deletion tombstones before restored data can serve traffic.

### 11.2 Safety copy

The About page and store listing include: “Fortuneness offers tarot-inspired reflections for entertainment and personal contemplation. It does not predict certain outcomes or provide medical, legal, financial, or mental-health advice.”

Fortune content must pass automated banned-pattern checks and editorial review. V1 content remains suitable without personalized communication or social features.

### 11.3 Operational visibility

Track without advertising identifiers:

- API request latency/error rate by route and code.
- Authentication success/failure category.
- Draw issued and allowance source.
- `NO_DRAWS_AVAILABLE` response count.
- Purchase start is client analytics; verified purchase/grant, renewal, expiration, refund, and webhook lag are server facts.
- Credit-ledger invariant violations.
- Crash-free sessions, reveal-animation errors, and asset-load failures.

Alerts:

- Health endpoint or database unavailable.
- App Store notification verification failures above threshold.
- Purchase acknowledgements failing or unfinished transactions increasing.
- Any negative spendable-credit invariant, duplicate business-effect constraint, or refund-state divergence.
- State/history p95 above 750 ms, draw p95 above 1.5 seconds, five-minute API 5xx rate above 2%, or fifteen-minute verified purchase-delivery failure rate above 1%.
- Any verified transaction not durably acknowledged within 60 seconds, after excluding an Apple/system pending purchase.

Never log access/refresh tokens, raw Apple identity tokens, full signed transaction JWS, fortune private history, or Apple private keys. The bounded encrypted notification store is access-controlled application data, not log output.

### 11.4 Backups and recovery

- Select a Railway PostgreSQL plan and backup configuration that meets launch RPO of 24 hours and RTO of 4 hours. Retain at least 30 daily recovery points or an equivalent point-in-time window.
- Before every production migration, confirm a restorable recovery point. Rehearse full restore plus deletion-tombstone replay in staging before launch and at least quarterly.
- Migrations are forward-compatible, reviewed, and deployed before API code that depends on them where necessary.
- Credit grants, ledger, purchase, notification, subscription, idempotency, and deletion tables receive invariant checks after restore before traffic is enabled.

---

## 12. Chronological implementation plan

Later phases may be prepared in parallel, but their acceptance gates are not skipped. The riskiest Apple-native and commerce assumptions are tested early.

### Phase 0 — Owner accounts, naming, and risk spikes

**Goal:** Remove external blockers and prove the two native integrations before building the full app.

- [ ] Confirm public name **Fortuneness**, App Store subtitle direction, support email, privacy-policy host, and legal entity/developer account.
- [ ] Reserve the final Apple bundle ID. Proposed: `app.fortuneness` if available.
- [ ] Create the App Store Connect app record and enable Sign in with Apple and In-App Purchase capabilities.
- [ ] Create the two IAP records using the final product IDs in section 7.1; put Oracle+ in one subscription group, configure the standard month-to-month pay-as-you-go plan with no 12-month commitment, and record the exact `billingPlanType` expected by server validation.
- [ ] Enable Billing Grace Period for Sandbox and Production, record its duration/scope, and configure separate V2 notification URLs.
- [ ] Create Expo/EAS project and credentials.
- [ ] Create Railway staging and production projects with separate PostgreSQL services.
- [ ] Confirm Google ADC access for the illustration pipeline.
- [ ] Assign an editorial owner and confirm capacity for 624 English templates and 78 reviewed illustration descriptions.
- [ ] Produce an initial trust-boundary/abuse-case review covering Apple identity-token forgery/replay, session replay, account switching, `appAccountToken`, StoreKit delivery, webhook verification, account caches, deletion, and credit/refund abuse. Assign every mitigation to a phase; no unresolved critical/high design finding may enter Phase 5 or 9.
- [ ] Build a throwaway vertical spike in the real mobile workspace:
  - configure Sign in with Apple and verify the signed IPA contains `com.apple.developer.applesignin`;
  - authenticate `GKLocalPlayer` in an EAS development build and verify persistent scoped IDs;
  - obtain identity-verification items on a physical device;
  - on Mac/Xcode, load a local `.storekit` configuration and verify Xcode-environment JWS with the exported test certificate;
  - in an EAS development/TestFlight build, load App Store Sandbox products and receive an Apple-verified JWS with `appAccountToken`.
- [ ] Verify Sign in with Apple account creation and reauthentication on a clean physical device before Phase 5 closes.
- [ ] Create the App Review access artifact: Sign in with Apple steps, free draw, Sandbox pack/subscription, **Restore Purchases**, and deletion instructions. Never share Apple Account credentials.

**Acceptance:** A physical iPhone build completes Sign in with Apple end to end, the signed IPA contains the entitlement, local Xcode and App Store Sandbox commerce paths are distinguished and pass, no critical/high design threat remains unresolved, and bundle/product IDs are locked before production code depends on them.

### Phase 1 — Repository and quality scaffold

**Goal:** Create an empty but production-shaped monorepo.

- [ ] Root npm workspaces with pinned Node 24/npm versions.
- [ ] Strict shared TypeScript config, ESLint, Prettier, EditorConfig, and `.gitignore`.
- [ ] Scaffold `apps/api`, `packages/api-contracts`, `packages/shared-types`, and `packages/fortune-content` first.
- [ ] Scaffold Expo mobile with SDK version locked to its compatible React Native version.
- [ ] Configure Expo Router, iOS-only platform target, `supportsTablet: true`, all orientations, URL scheme, dark launch screen, Secure Store, `expo-sqlite`, English localization plus a debug/test-only length-expanded pseudo-locale unavailable in production builds, notifications, and EAS profiles.
- [ ] Add `expo-apple-authentication` and the local IAP Expo module established in the spike.
- [ ] Add the Sign in with Apple capability through app config/config plugin, confirm the remote App ID capability, regenerate profiles, inspect `npx expo config --type introspect`, and verify the signed development IPA entitlement.
- [ ] Add root scripts: `lint`, `format:check`, `typecheck`, `test`, and workspace builds.
- [ ] Add CI for install-from-lockfile, lint, format, typecheck, unit tests, content validation, and asset validation.
- [ ] Add `.env.example` files with placeholders only.

**Acceptance:** Fresh checkout installs from the lockfile; all root checks pass; an EAS development build launches on iPhone and iPad without Expo Go.

### Phase 2 — Design system and adaptive vertical slice

**Goal:** Prove the visual language and layout before producing 78 assets.

- [ ] Implement design tokens, typography, spacing, safe-area page shell, adaptive grid, buttons, sheets, status banners, skeletons, and error states.
- [ ] Generate the three-card ADC vertical slice and integrate it through the code-rendered card frame.
- [ ] Author and approve all 24 English fortune combinations for the slice (`3 cards × 2 orientations × 4 intentions`) plus three reviewed illustration descriptions; use them to lock the editorial/safety rubric.
- [ ] Build static Oracle, Reveal, Collection, Shop, and Settings fixtures.
- [ ] Implement default and Reduce Motion reveal prototypes.
- [ ] Test 320 pt width, modern compact/large iPhones, iPad portrait/landscape, split view, large text, VoiceOver, and Reduce Motion.
- [ ] Lock the art prompt/style manifest only after real-device review.

**Acceptance:** The static vertical-slice fixtures have no clipping or overlap on the Phase 2 matrix; card text is code-rendered and accessible; the 24 English sample templates, three illustration descriptions, editorial rubric, and art style are approved for continued production.

### Phase 3 — API skeleton and shared contracts

**Goal:** Deploy a secure, testable API shell to Railway staging.

- [ ] Express app factory separate from process startup.
- [ ] Zod environment validation and contract validation.
- [ ] Generate OpenAPI from `packages/api-contracts` and fail CI on route/example/schema drift.
- [ ] Helmet, explicit CORS policy, proxy configuration for Railway, body-size limits, request IDs, structured logging, rate-limit framework, and normalized errors.
- [ ] `/health` with process and database readiness.
- [ ] Graceful shutdown and migration/deployment commands.
- [ ] Unit and Supertest coverage for health, errors, validation, and rate limits.
- [ ] Railway configuration with deterministic build/start commands and health check.
- [ ] Commit the Phase 0 identity/commerce trust-boundary document and map each required control into shared contracts and tests.

**Acceptance:** Railway staging deploys, health is green, invalid input never reaches services, OpenAPI matches implementation, the identity/commerce trust boundaries and failure modes are represented in contracts, and the API test suite passes.

### Phase 4 — PostgreSQL schema, migrations, and seed foundation

**Goal:** Make database integrity the foundation, not an afterthought.

- [ ] Implement section 8 models/enums/indexes/checks in Prisma plus migration SQL where Prisma cannot express a constraint.
- [ ] Add seed data for canonical 78-card metadata and three-card development content.
- [ ] Freeze the versioned English content/alt-text schema and validators so editorial production can continue independently of feature work.
- [ ] Add transaction helpers and database error mapping.
- [ ] Add local/staging migration runbook; production uses `migrate deploy` only.
- [ ] Add repository/service tests against an isolated test database.
- [ ] Verify backup and restore procedure in staging.

**Acceptance:** An empty database migrates and seeds deterministically; a second seed is idempotent; integrity tests prove duplicate draw/purchase/ledger records are rejected.

Full-deck art, alternative-text authoring, and fortune-template production proceed in parallel with Phases 5–10. Progress gates are 20 fully complete cards—art, alt text, and all eight intention/orientation templates, 160 templates total—by Phase 8, and 58 fully complete cards, 464 templates total, by Phase 10. These are phase acceptance gates; missing either triggers schedule/scope review without weakening the 624-template English launch minimum.

### Phase 5 — Sign in with Apple identity and app sessions

**Goal:** A player can securely authenticate on device and remain signed in.

- [ ] Integrate the native Apple authentication button and identity-token exchange without requesting name or email scopes.
- [ ] Implement hardened server verification, key caching, exact signed-byte construction, bounded proof fingerprint replay defense, versioned/dual-read HMAC identity storage, atomic first-login upsert, and bundle-ID validation.
- [ ] Implement access tokens with authoritative session-version checks, hashed rotating refresh families, same-key refresh replay receipts, logout, and Apple reauthentication.
- [ ] Implement account-switch handling and account bootstrap response.
- [ ] Build launch/auth/unavailable/deletion-management UI states, including unauthenticated legal/support access.
- [ ] Test invalid signature, nonpersistent ID, stale proof, wrong bundle, proof replay, key-fetch failure, pepper rotation, concurrent first login, lost refresh response, concurrent same-key refresh, malicious different-key replay, immediate session invalidation, and player switching.

**Acceptance:** The same Apple subject maps to one user across two devices and key rotation; another Apple subject never sees the first account's cache/data; invalid, stale, wrong-audience, wrong-nonce, or replayed tokens cannot establish a session; logout/deletion invalidates already-issued access tokens immediately.

### Phase 6 — Fortune engine and daily allowance

**Goal:** Issue exactly the right number of fortunes under concurrency.

- [ ] Implement monotonic allowance periods and the current/pending/effective IANA time-zone state machine.
- [ ] Implement `/fortune/state` and atomic `/fortunes/draw`.
- [ ] Implement allowance priority, header idempotency/request hashes, stable user/financial locks, exact selection probabilities, immutable localized/alt snapshot, and the one-unviewed-draw constraint.
- [ ] Add a temporary internal entitlement fixture for tests; do not ship a client entitlement bypass.
- [ ] Add property/concurrency tests for 50+ simultaneous requests, same-key/same-payload, same-key/different-payload, different-key races, lock retry exhaustion, reset boundaries, east/west zone changes, DST, partial/fully consumed refunds with nonnegative balance, and subscription expiration mid-request.

**Acceptance:** A non-subscriber receives exactly one free draw per monotonic allowance period; a subscriber exactly 11 before pack credits; same-key retries return one identical draw, different input cannot reuse a key, at most one unviewed draw exists, and concurrency never over-issues.

### Phase 7 — Oracle and reveal connected to API

**Goal:** Complete the free daily ritual end to end.

- [ ] Connect auth bootstrap, TanStack Query memory state, and account-partitioned SQLite persistence.
- [ ] Build intention selector, card draw, server wait state, reveal, reading copy, quota update, exhausted state, and resume after termination.
- [ ] Establish account-partitioned SQLite storage, persist the pending reveal and readings available to Phase 7, and clear memory/SQLite immediately on player change, logout, deletion, or ownership mismatch.
- [ ] Implement the offline shell and explicit online requirement for draws and commerce; full archive synchronization begins in Phase 8.
- [ ] Add accessible haptics/sound settings and Reduce Motion behavior.
- [ ] Instrument draw success/failure without logging fortune text.

**Acceptance:** A first-time player completes the free draw. Kill/relaunch tests cover before request, after issuance, during flip, during text reveal, after full VoiceOver-readable content, and while viewed acknowledgement retries; each resumes deterministically without reroll, loss, or a second unviewed draw.

### Phase 8 — Collection and reading archive

**Goal:** Keep every acquired fortune saved and browsable for the lifetime of the account.

- [ ] Implement cursor-paginated history, cursor-paginated per-card readings, and the 78-card collection summary endpoints.
- [ ] Build Deck/Readings modes, filters, progress, locked cards, card detail, and reading detail.
- [ ] Use virtualized/adaptive grids and image caching.
- [ ] Implement latest-200 synchronization, saved-count/last-sync/partial labels, older-page LRU caching, and the 50 MiB account-cache limit.
- [ ] Add empty, loading, saved/partial-offline, pagination retry, all-cards-unlocked, and large-history states.
- [ ] Test thousands of draws in fixtures and ensure bounded memory use.

**Acceptance:** Collection progress/history match server truth on two devices; offline exposes exactly its saved scope and last sync; per-card history remains bounded; scrolling/filtering stay smooth and accessible on the smallest iPhone and split-view iPad; the parallel content gate has 20 fully complete cards and 160 reviewed templates.

### Phase 9 — StoreKit client and purchase backend

**Goal:** Deliver and reconcile money-bearing transactions exactly once.

- [ ] Finish StoreKit 2 local module: launch-time updates listener, products, purchases, verified JWS, current entitlements, unfinished transactions, explicit-only sync, manage-subscription destination, and `appAccountToken`.
- [ ] Implement server JWS verification and one atomic application service shared by client delivery, `ONE_TIME_CHARGE`, notifications, and reconciliation.
- [ ] Implement financial-subject/token history, nonnegative pack grants/refund units, monotonic subscription reducer, transaction disposition, and reconciliation APIs.
- [ ] Implement separate internal financial IDs and purchase tokens, versioned token HMAC lookup, active-token encryption/rotation, purge crypto-erasure, and closed-owner terminal dispositions.
- [ ] Implement V2 notification matrix including `CONSUMPTION_REQUEST`, consent/default-off behavior, bounded encrypted replay storage, Transaction History V2 reconciliation, and distributed job locking.
- [ ] Add secrets for App Store Server API keys only to Railway secret storage.
- [ ] Test pending/cancel, network loss, kill before finish, crash after every atomic-application step, client/webhook/reconcile races, distinct notifications for one event, `ONE_TIME_CHARGE`, full/partial/reversed/declined refunds by product type, refund-before-delivery then reversal, stale refund after newer reversal, renewal/grace/retry/expiration/revoke out of order, pack/subscription consent on/off, nil-token known renewal/duplicate, nil/unknown unowned token, other-owner privacy-safe response shape, token HMAC/encryption rotation and purge erasure, closed owner, account switch before acknowledgement, unexpected subscription `billingPlanType`, Xcode/Sandbox/Production mismatch, and explicit-only `AppStore.sync()`.

**Acceptance:** Xcode-local and Sandbox matrices pass without trust crossover; client death loses or duplicates nothing; every verified mapped Sandbox transaction is durably acknowledged within 60 seconds exactly once; replay/out-of-order input converges; an independently accepted non-refunded later pack yields 10 spendable units and a closed subject receives none.

### Phase 10 — Shop and monetized allowance UX

**Goal:** Expose purchases clearly without weakening the free ritual.

- [ ] Build Shop from live StoreKit products and server benefit catalog.
- [ ] Build repeatable consumable Fortune Pack purchase, standard month-to-month Oracle+ purchase, explicit **Restore Purchases**, Manage Subscription, success/pending/cancel/error states, and disclosure links.
- [ ] Connect subscription and pack balances to Oracle.
- [ ] Ensure the 11th daily subscriber draw exhausts the subscriber quota before touching pack credits.
- [ ] Add storefront/payment-restriction states and keep prices localized.
- [ ] Review all paywall copy for accuracy and absence of dark patterns.

**Acceptance:** Both products work in sandbox on iPhone and iPad; quotas update without restarting; an expired subscriber keeps unlocked cards and the base daily fortune; the parallel content gate has 58 fully complete cards and 464 reviewed templates.

### Phase 11 — Full deck and fortune content finalization

**Goal:** Finalize, integrate, and release-gate the complete catalog produced through the parallel editorial workstream.

- [ ] Generate, normalize, manifest, and visually review all 78 ADC illustrations.
- [ ] Complete at least 624 reviewed English templates; target 1,248.
- [ ] Author and editorially review English alternative text for all 78 illustrations.
- [ ] Run locale/combination, length, duplicate, prohibited-language, alt-text, asset, checksum, and referential-integrity validation.
- [ ] Review every card in its actual frame at compact and regular size.
- [ ] Version the content seed and implement safe upsert behavior that never changes old draw snapshots.
- [ ] Confirm final app bundle size, decode memory, and cold-load performance.

**Acceptance:** No English fortune-template combination is missing, and every one of the 78 cards has one reviewed English illustration description; every card passes VoiceOver review upright/reversed; all assets pass QA; editorial sign-off is recorded; a production-like seed never rewrites historical draws.

### Phase 12 — Settings, reminder, legal, and deletion

**Goal:** Complete player control and App Store account requirements.

- [ ] After the first draw, offer reminders; request notification permission only after explicit opt-in, then implement local scheduling, bounded old/new-zone one-shot transitions, time changes, and launch-time schedule refresh.
- [ ] Finish sound/haptic/motion preferences.
- [ ] Publish Privacy Policy, Terms of Use/EULA link, support path, and entertainment disclaimer.
- [ ] Implement the 300-second Apple `auth_time` deletion gate, applicable confirmations, immediate session invalidation, deletion-management token/status/cancel, global purge lock order, irreversible financial benefit cutoff, conditional subscription warning/manage link, and deterministic post-purge recreation behavior.
- [ ] Implement the section 3.6 optional versioned pack/subscription consumption-information consent, deployment flag, default-off behavior, revocation, product-specific payload rules, and Privacy Policy/App Privacy disclosure.
- [ ] Add privacy manifest and complete an initial App Privacy label worksheet.
- [ ] Confirm the app requests only capabilities/permissions it uses.

**Acceptance:** Reminder works across reboot and an old/new-zone transition while the app remains terminated, without assuming push/background execution; consent is informed, optional, revocable, and tested off/on for both eligible product types; deletion tests cover stale/fresh reauthentication, lost response, unused credits, active and paid-through-cancelled subscriptions, unknown subscription status, grace-period cancellation, purge, late Apple events, and reinstall; Privacy/Terms/disclaimer/support are reachable from authenticated and every unauthenticated/blocked state.

### Phase 13 — Security, reliability, and performance hardening

**Goal:** Make failure boring and recoverable.

- [ ] Revalidate and penetration-test the Phase 0 trust/abuse model for Apple token forgery/replay, session replay, transaction forgery/replay, webhook spoofing, account switching, quota races, cache leaks, deletion races, and refund abuse.
- [ ] Add rate limits, timeouts, outbound-request restrictions, secret rotation procedure, dependency audit, and production log redaction tests.
- [ ] Add Sentry/error reporting with environment separation and PII scrubbing.
- [ ] Add database query/route latency metrics, purchase alerts, and reconciliation dashboards.
- [ ] Load-test auth, state, draw, history, and webhook endpoints.
- [ ] Profile mobile startup, card reveal, collection scroll, memory pressure, and background/foreground transitions on the oldest supported test device.

**Acceptance:** No critical/high unresolved finding. During a 15-minute staging run with 100 concurrent authenticated sessions, state/history p95 is at most 750 ms, draw p95 at most 1.5 seconds, API 5xx below 1%, and no draw/quota/ledger/isolation invariant fails. Every mapped verified Sandbox transaction is acknowledged within 60 seconds exactly once.

### Phase 14 — Complete device and commerce QA

**Goal:** Verify the “no visual bugs on iPhone/iPad” requirement systematically.

Test at minimum:

- 320–375 pt compact widths and a large Pro Max width.
- iPad mini and 11/13-inch regular layouts.
- Portrait, landscape, Split View narrow/wide, and Stage Manager resizes.
- Current minimum supported OS and newest release candidate/current OS.
- Default text through accessibility text sizes.
- English plus a length-expanded pseudo-locale for clipping, VoiceOver order, and layout resilience.
- VoiceOver, Reduce Motion, Reduce Transparency, Bold Text, Button Shapes, and high contrast.
- Slow/offline/flapping network; Railway restart; expired access token; player switch.
- Fresh, partial, complete 78-card collection; 10,000-reading fixture.
- Every StoreKit scenario listed in Phase 9.

Visual defect zero-tolerance criteria:

- No clipped essential text, overlapping controls, inaccessible buttons, unexpected horizontal scroll, unsafe-area collision, broken card ratio, invisible focus, or modal outside the window.
- No unrecoverable loading state or blank page.
- No layout that requires a particular orientation.
- Screenshots are captured for the matrix and compared during release QA.

Every zero-tolerance item above is release-blocking regardless of whether triage would otherwise label it P2. Cosmetic deviations may remain only when they affect none of these criteria and have an owner.

**Acceptance:** All P0/P1 defects closed; no known purchase, entitlement, quota, auth, deletion, or data-isolation defects; documented screenshots pass human review.

### Phase 15 — Staging, TestFlight, and App Review preparation

**Goal:** Exercise the production-shaped system before submission.

- [ ] Deploy Railway staging API/database and run migrations/seed.
- [ ] Configure sandbox App Store notification URL and successfully request a test notification.
- [ ] Create internal TestFlight build, then external beta after internal stability.
- [ ] After external beta begins, run a final seven-day measurement with at least 200 sessions and at least 99.5% crash-free sessions using actionable, PII-safe telemetry.
- [ ] Verify production Railway service, database backups, secrets, domain/TLS, health, and notification URL separately.
- [ ] Prepare App Store name, subtitle, description, keywords, screenshots for iPhone and iPad, privacy details, age-rating questionnaire, IAP screenshots, subscription terms, support URL, privacy URL, and review notes.
- [ ] Attach the Phase 0 reviewer-access artifact. Review notes explain Sign in with Apple auto-provisioning, daily rules, exact free draw, Sandbox pack/subscription, **Restore Purchases**, local disconnect, and deletion steps. Never share Apple credentials; keep the backend live.
- [ ] Submit IAP products with the app version if required.

**Acceptance:** External TestFlight users complete free/paid/deletion flows; the final seven-day sample contains at least 200 sessions at 99.5% or better crash-free and the commerce SLOs pass; production smoke test succeeds without fabricated production purchases; reviewer access has been rehearsed on a clean device; App Review materials are complete.

### Phase 16 — Production launch

**Goal:** Release safely with a rollback/response plan.

- [ ] Freeze content and schema changes except launch blockers.
- [ ] Take/confirm production backup and deploy compatible migrations first.
- [ ] Maintain API/schema compatibility with the current and immediately previous supported app builds.
- [ ] Document the last-known-good API artifact, forward-compatible database procedure, rollback owner, and rehearsed rollback commands/runbook.
- [ ] Provide independent server-controlled switches for new draws and new purchase initiation. Disabling initiation must not stop unfinished delivery, **Restore Purchases**, refunds, notifications, or reconciliation.
- [ ] Deploy the production API; verify health, authentication, fortune state, content, and commerce-catalog read-only preconditions; then release the approved app gradually where available.
- [ ] Monitor auth failures, draw issuance, duplicate constraints, credit balances, unfinished purchase delivery, App Store webhooks, crash-free sessions, and support messages.
- [ ] Do not use an OTA update to change native modules, IAP capability, entitlement code requiring native changes, or runtime-incompatible code.
- [ ] Maintain a same-day response owner for purchase/account issues during launch week.
- [ ] Halt rollout and invoke the response plan for any duplicate grant/debit, quota over-issue, cross-account disclosure, five-minute API 5xx above 2%, or fifteen-minute purchase-delivery failure above 1%.

**Acceptance:** A 24-hour production-shaped staging soak meets Phase 13 SLOs; rollback and both commerce/draw switch drills succeed; no P0/P1 issue is open; production remains within the defined thresholds during gradual release.

### Phase 17 — Post-launch iteration

Prioritize evidence, not scope creep:

1. Fix reliability, accessibility, and purchase support issues.
2. Improve fortune content with versioned additions.
3. Consider an annual Oracle+ option only after monthly retention/value is understood.
4. Consider share cards, widgets, Live Activities, or daily streaks only if they preserve the calm ritual and do not punish missed days.
5. Evaluate native macOS/visionOS presentations before advertising “all Apple devices.” Apple Watch and Apple TV require purpose-built experiences, not scaled phone screens.
6. Add a small authenticated content/admin tool only when seed-file operations become a real bottleneck.
7. Review privacy-preserving product measures—onboarding/free-reading completion, return rate, reveal abandonment, Shop visits, conversion, refund rate, and subscriber allowance use—against documented targets and retention before expanding scope.

---

## 13. Test plan and release gates

### 13.1 Automated test priorities

Highest-risk logic must have the strongest tests:

1. Draw same-key/same-input success and terminal-conflict replay, key/input conflicts, one-unviewed constraint, lock retries, and concurrent allowance consumption.
2. Atomic IAP application and exactly-once grant/draw/refund/reinstatement effects across client, webhook, and reconciliation races.
3. Monotonic StoreKit signature, ownership, notification-order, subscription, consent, and refund-state reduction.
4. Apple JWT signature/issuer/audience/nonce/freshness validation, token replay, concurrent first login, and HMAC-key rotation.
5. Session-version invalidation, shared lock ordering, recent Apple `auth_time`, lost/concurrent refresh response handling, logout repetition, account switching, and memory/SQLite cache isolation.
6. Monotonic allowance periods and east/west/DST/time-zone-change behavior, including suppression of both candidate resets before one effective boundary.
7. Account deletion races, lost request response, deletion-management access, locked terminal financial cutoff, purge minimization, and late Apple events.
8. English content/asset/alt-text completeness and historical snapshot immutability.

### 13.2 Core acceptance scenarios

| Scenario | Expected result |
| --- | --- |
| Same draw key and same input race | One `201`; every replay is `200` with the identical draw; one usage exists. |
| Same draw key with different intention | No new mutation; `409 IDEMPOTENCY_KEY_REUSED`. |
| Different draw keys race for one allowance | One `201`; because that draw is unviewed, the other returns `409 UNVIEWED_READING_PENDING` with the same owned draw; one usage exists. |
| A terminal draw response is lost | Same key replays the stored `UNVIEWED_READING_PENDING` or `NO_DRAWS_AVAILABLE` outcome even after state changes; a deliberate later draw uses a new key. |
| Subscriber has 11 draws | First uses free, next 10 use subscription, 12th uses a pack credit if available. |
| Subscription events arrive renewal → revoke → stale renewal | Reduction converges on the newest authoritative paid/grace/revocation facts; stale input cannot restore access. |
| Pack delivery response is lost | Transaction remains unfinished; retry returns accepted duplicate disposition; one 10-unit grant exists and `finish()` becomes safe. |
| Client delivery, `ONE_TIME_CHARGE`, and reconciliation race | One transaction disposition and one 10-unit grant commit atomically. |
| App dies during any reveal step | Relaunch continues the sole unviewed reading; no second allowance is consumed; acknowledgement eventually clears it. |
| A different Apple Account is selected during reauthentication | The mismatch is refused; a deliberate disconnect clears the old cache before another account can sign in. |
| Player switches after purchase success but before acknowledgement | Business key/token routes the grant to the recorded old financial subject; response is `DELIVERED_TO_OTHER_ACCOUNT` with no old-owner state/data; transaction finishes exactly once. |
| Known renewal or duplicate arrives with nil token | Existing transaction/original-transaction ownership wins; the event applies to that immutable owner and is not quarantined. |
| Refresh response is lost | Same-key retry within 120 seconds returns the same replacement; different-key reuse revokes the family. |
| Device clock jumps | Server allowance and reset remain unchanged. |
| Time zone changes east or west after free draw | Pending state is visible; the current period's sole boundary moves to the later candidate reset, both earlier candidate resets are suppressed, and exactly one new monotonic period begins there. |
| App Store event repeats under different notification UUIDs | Business effect remains idempotent by environment + transaction/original-transaction key. |
| Full refund after all 10 pack units were spent | Spendable balance stays zero/nonnegative; 10 current unrecovered units are audited; free/subscription remain; an independent non-refunded later pack adds 10 spendable units. |
| Partial refund then newer `REFUND_REVERSED`, then stale refund | Only unspent target units are removed and reinstated once; current unrecovered state clears; the stale refund is audit-only and cannot re-debit. |
| Refund arrives before pack delivery, then reverses | The atomic grant plus refund target initially exposes only unrefunded units; reversal materializes the original grant exactly once if the owner remains open. |
| Pack/subscription `CONSUMPTION_REQUEST` without/with consent | Without consent no data is sent; with valid consent an accurate product-specific minimized payload is sent within 12 hours, without subscription `consumptionPercentage`. |
| Delete races draw/refresh and later renewal | Shared locks/session version prevent new personal mutation; purge closes the financial subject under lock; renewal is retained as a minimized terminal no-benefit event. |
| Delete response is lost | The revoked-session retry is `423`; fresh Apple authentication returns deletion-management state and cannot create a second request. |
| Offline launch with partial cache | Saved count and last sync are visible; filters cover only saved readings; Draw and commerce explain network requirement. |
| Dynamic Type maximum | Essential copy reflows/scrolls; no control becomes unreachable. |

### 13.3 Definition of done for every feature

- Shared contract and error states defined.
- Server authorization and validation implemented.
- Loading, empty, error, offline, and retry UI implemented where applicable.
- Compact/regular and accessibility behavior verified.
- Unit/integration tests added in proportion to risk.
- Logs/metrics added without sensitive data.
- No unrelated permission or tracking added.
- Documentation and environment examples updated.

---

## 14. Configuration and secrets

Expected API environment variables, names subject to implementation validation:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://...
TRUST_PROXY=0
CORS_ORIGINS=
APP_BUNDLE_ID=app.fortuneness
APP_APPLE_ID=
SUPPORTED_LOCALES=en
DEFAULT_LOCALE=en
APPLE_IDENTITY_HMAC_KEYS_JSON={"v1":"base64-key"}
APPLE_IDENTITY_CURRENT_KEY_VERSION=v1
APPLE_IDENTITY_TOKEN_MAX_AGE_SECONDS=300
APPLE_IDENTITY_TOKEN_CLOCK_SKEW_SECONDS=60
JWT_ACCESS_KEYS_JSON={"v1":"base64-key"}
JWT_ACCESS_CURRENT_KEY_VERSION=v1
JWT_ISSUER=fortuneness-api
JWT_AUDIENCE=fortuneness-mobile
REFRESH_TOKEN_HMAC_KEYS_JSON={"v1":"base64-key"}
REFRESH_TOKEN_CURRENT_KEY_VERSION=v1
REFRESH_REPLAY_ENCRYPTION_KEYS_JSON={"v1":"base64-key"}
REFRESH_REPLAY_CURRENT_KEY_VERSION=v1
APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON={"v1":"base64-key"}
APP_ACCOUNT_TOKEN_HMAC_CURRENT_KEY_VERSION=v1
APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON={"v1":"base64-key"}
APP_ACCOUNT_TOKEN_ENCRYPTION_CURRENT_KEY_VERSION=v1
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
ACCOUNT_DELETION_REAUTH_MAX_AGE_SECONDS=300
APPLE_IAP_ISSUER_ID=
APPLE_IAP_KEY_ID=
APPLE_IAP_PRIVATE_KEY_BASE64=
APPLE_IAP_ENVIRONMENT=SANDBOX
APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON={"v1":"base64-key"}
APP_STORE_NOTIFICATION_CURRENT_KEY_VERSION=v1
APP_STORE_NOTIFICATION_RAW_TTL_DAYS=90
APPLE_CONSUMPTION_INFO_ENABLED=false
IAP_FORTUNE_PACK_10_PRODUCT_ID=app.fortuneness.fortunepack10
IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID=app.fortuneness.oracleplus.monthly
IAP_ORACLE_PLUS_MONTHLY_EXPECTED_BILLING_PLAN_TYPE=
SENTRY_DSN=
LOG_LEVEL=info
ACCOUNT_PURGE_DELAY_DAYS=30
```

Rules:

- Real values never enter git, screenshots, issue comments, or logs.
- Production and staging use different databases, secrets, Sentry environments, and App Store environment configuration.
- Validate every variable at process start and fail closed on invalid commerce/auth configuration.
- Production validates an explicitly tested Railway proxy-hop policy; `TRUST_PROXY=0` is local-only and the deployment never trusts arbitrary forwarded addresses.
- Versioned key sets keep the current and approved previous versions during rotation. Removing an identity, JWT, refresh, replay-receipt, app-account-token, or notification-encryption key requires a completed migration/expiry audit.
- App-account-token HMAC rotation uses dual-read/current-write lookup and backfills active bindings; encryption rotation rewraps every active raw token. A digest key required to route retained post-purge Apple events remains available for the disclosed financial-retention window or is migrated through an audited offline mapping before removal.
- Apple private keys are least-privilege, encrypted at rest in Railway, rotatable, and never exposed to mobile code.
- Xcode StoreKit test certificates and `Environment.XCODE` configuration are local-only and are rejected if present in staging or production.

---

## 15. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Sign in with Apple capability or reviewer flow is misconfigured | Rehearse first sign-in and reauthentication on a clean physical device and include exact review notes. |
| App Store purchase identity differs from the application identity | Bind purchases to immutable financial-subject token history, route every known-owner delivery without disclosure, quarantine unknown tokens, forbid cross-account transfer, and provide an audited support path. |
| Consumables are absent from current entitlements or the client never returns | Unified atomic application from unfinished delivery, `ONE_TIME_CHARGE`, and reconciliation; one environment-scoped transaction disposition and grant. |
| Refund arrives repeatedly, out of order, or after credits are consumed | Milliunit-correct, source-ordered per-grant reduction, nonnegative spendable balance, unrecovered-unit audit, and no old refund debt applied to a later pack. |
| Daily quota race across devices | Server clock, stable per-user/financial locks in one order, request-hashed idempotency, unique constraints, and bounded retry behavior. |
| Time-zone manipulation | Explicit current/pending/effective state, one extended current-period boundary that suppresses both candidate resets, monotonic period IDs, 168-hour limit, and audited support override. |
| Deletion conflicts with active Apple billing or late transactions | Unconditional Request account deletion action, conditional billing acknowledgment/manage link, immediate session-version invalidation, locked terminal financial tombstone, zero benefit after purge, and no transfer to a recreated account. |
| AI art inconsistency or text artifacts | Three-card style gate, manifest, no generated labels, asset QA, human review of all 78 cards. |
| Full deck increases app size/memory | Optimized shipping assets, bounded decode sizes, real-device profiling, bundle-size gate. |
| Subscription perceived as weak ongoing value | Clear 10-per-day ongoing allowance, complete free tier, regular versioned content additions after launch. |
| Oracle+ is accidentally configured as a 12-month commitment plan | Phase 0 records the intended standard month-to-month `billingPlanType`; catalog, transaction, Sandbox, and App Review checks fail closed on mismatch. |
| Mystical UI harms purchase clarity/accessibility | Keep Shop terms plain, use StoreKit prices, high contrast, Dynamic Type, VoiceOver, and Reduce Motion fallbacks. |
| Windows development cannot compile iOS locally | Use EAS development builds and a physical iOS test device; schedule Mac/Xcode access for native debugging and StoreKit configuration tests. |

---

## 16. Owner decisions still required

These do not block writing the scaffold, but must be resolved by the named phase:

| Decision | Deadline | Recommended default |
| --- | --- | --- |
| Final bundle ID | Phase 0 | `app.fortuneness` if available |
| Support/privacy domain and email | Phase 0 | A dedicated product domain and `support@…` |
| Launch identity/reviewer path | Phase 0 hard gate | Sign in with Apple verified on a clean physical device before Phase 5 |
| Monthly subscription billing model | Phase 0 | Standard month-to-month pay-as-you-go; explicitly reject a 12-month commitment plan and record the exact current Apple `billingPlanType` value |
| Billing Grace Period duration/scope | Phase 0 | Enable for Sandbox and Production using the current Apple option selected for the monthly product; document the exact verified grace expiration behavior |
| Railway backup plan | Phase 0 | A plan/configuration meeting 24-hour RPO, 4-hour RTO, and 30 recovery points |
| Monthly subscription price tier | Before Phase 9 sandbox merchandising | Choose after competitor/value review; never hardcode in app |
| 10-pack price tier | Before Phase 9 sandbox merchandising | Price below one month but high enough that subscription is the high-frequency option |
| Consumption-information production rollout | Phase 12 | Keep the deployment flag off until privacy/legal approval and both product-specific consent paths pass; disabled means no setting and no data sent |
| Minimum OS version | Phase 1 | Choose the oldest version supported by the selected stable Expo SDK and StoreKit/GameKit implementation, then test it; do not raise casually |
| Final visual style from the three-card ADC proof | Phase 2 | Nocturnal Art Nouveau/celestial direction in section 4 |
| One or two text variants per combination | Phase 4 | Ship two if editorial capacity remains high quality; 624 English templates are the hard minimum |
| Monitoring provider | Phase 13 | Sentry without ad tracking |

Everything else in this document is considered the implementation default.

---

## 17. Authoritative platform references

Implementation must recheck current official documentation at the phase where platform code is written:

- Apple, [Implementing User Authentication with Sign in with Apple](https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple)
- Apple, [Fetch Apple’s public key for verifying token signature](https://developer.apple.com/documentation/signinwithapplerestapi/fetch-apple%27s-public-key-for-verifying-token-signature)
- Apple, [Protecting player privacy with scoped identifiers](https://developer.apple.com/documentation/gamekit/protecting-the-player-s-privacy-using-scoped-identifiers)
- Apple, [StoreKit 2](https://developer.apple.com/storekit/)
- Apple, [`Transaction` and signed JWS verification](https://developer.apple.com/documentation/storekit/transaction)
- Apple, [`appAccountToken`](https://developer.apple.com/documentation/storekit/transaction/appaccounttoken)
- Apple, [`Transaction.currentEntitlements`](https://developer.apple.com/documentation/storekit/transaction/currententitlements)
- Apple, [`Transaction.updates`](https://developer.apple.com/documentation/storekit/transaction/updates), [`Transaction.unfinished`](https://developer.apple.com/documentation/storekit/transaction/unfinished), and [`AppStore.sync()`](https://developer.apple.com/documentation/storekit/appstore/sync%28%29)
- Apple, [App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications)
- Apple, [App Store Server Notifications V2 types](https://developer.apple.com/documentation/appstoreservernotifications/notificationtype), [`revocationPercentage`](https://developer.apple.com/documentation/appstoreserverapi/revocationpercentage), and [Send Consumption Information](https://developer.apple.com/documentation/appstoreserverapi/send-consumption-information)
- Apple, [Billing Grace Period](https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions/)
- Apple, [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- Apple, [Human Interface Guidelines — In-App Purchase](https://developer.apple.com/design/human-interface-guidelines/in-app-purchase)
- Apple, [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Expo, [Using in-app purchases](https://docs.expo.dev/guides/in-app-purchases/)
- Expo, [iOS capabilities with EAS Build](https://docs.expo.dev/build-reference/ios-capabilities/)
- Expo, [Add custom native code](https://docs.expo.dev/workflow/customizing/)
- Expo, [Expo Modules API](https://docs.expo.dev/modules/get-started/)
- Expo, [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)

If an official platform requirement conflicts with this document at implementation time, document the conflict and update this specification before changing behavior.
