# Phase 10 paywall copy review

Status: **OPEN** — automated rows pass; the device/Sandbox and editorial-signoff rows below are not closed.

Owner: product/editorial owner plus the iOS QA owner to be assigned

Implementation baseline: the Phase 10 commerce UX commit or later

Specification gate: Phase 10 — Shop and monetized allowance UX (spec sections 3.5, 6.4, 7.2)

This record covers the Phase 10 requirement to review all paywall copy for accuracy and the absence of dark patterns. It exists because a local test run can prove a string is rendered, not that the string is true on a device, in another storefront, or under App Review.

## Where the copy lives

| Surface                               | Source                                                        | Authored by                             |
| ------------------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| Product title and price               | StoreKit `displayName` / `displayPrice`                       | App Store Connect, per storefront       |
| Billing period and introductory offer | StoreKit `subscriptionPeriod` / `introductoryOffer`           | StoreKit, eligibility-checked           |
| What a purchase grants                | `GET /v1/iap/catalog` benefit descriptions                    | Server (`apps/api/src/iap/commerce.ts`) |
| Renewal and consumable disclosure     | `describeDisclosure` in `apps/mobile/src/iap/shop-catalog.ts` | App, from StoreKit values only          |
| Status, outcome, and failure copy     | `apps/mobile/src/iap/shop-catalog.ts`                         | App                                     |
| Shop layout and legal links           | `apps/mobile/app/shop.tsx`                                    | App                                     |

No price, currency, or period is written by hand anywhere in the app. `describeDisclosure` composes its sentence from StoreKit values, so an unavailable product shows "Price unavailable right now" instead of a guess.

## Accuracy claims and their evidence

| Claim made to the player                                               | Evidence                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A pack adds exactly 10 spendable credits                               | Server benefit `units: 10`; `apps/api/src/iap/pack-ledger.test.ts`                                     |
| Oracle+ adds 10 readings per eligible account day                      | `apps/api/src/fortune/allowance.test.ts`                                                               |
| Oracle+ readings are spent before pack credits                         | `apps/api/src/fortune/monetized-allowance.integration.test.ts` (12-draw day)                           |
| The free daily reading is always included                              | Same integration test; free reading survives subscription expiry                                       |
| A grace period still grants subscriber readings                        | `resolveSubscriptionAllowance`; `allowance.test.ts`                                                    |
| Restore Purchases never creates a charge                               | `restorePurchases` calls `AppStore.sync()` then reconcile only; `commerce-delivery.test.ts`            |
| Nothing is granted before server verification                          | `CommerceDeliveryCoordinator` finishes only on `deliveryAccepted && safeToFinish`                      |
| An introductory offer is shown only when the Apple Account is eligible | `isEligibleForIntroOffer` gate in `FortunenessIapModule.swift`; `shop-catalog.test.ts`                 |
| Cancelling Oracle+ keeps collected cards and readings                  | Readings and collection are never entitlement-gated; integration test asserts the draw survives expiry |

## Dark-pattern checklist

| Pattern to avoid                            | Decision in Phase 10                                                                                      | Status |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| Countdown, scarcity, or urgency framing     | No timers, no "limited", no streak loss. The exhausted Oracle shows only the next reset time.             | Pass   |
| Interstitial or blocking paywall            | Shop is never presented automatically; it is a page action and one quiet link after exhaustion.           | Pass   |
| Attention-grabbing badge on the Shop action | One 6-point static dot, gold-muted, only after allowance exhaustion; no flash, count, or animation.       | Pass   |
| Cancellation treated as an error            | `mapPurchaseResult` returns a neutral `CANCELLED` phase; no alert, no re-ask.                             | Pass   |
| Confirmshaming / guilt wording              | No decline copy exists; there is no "no thanks, I prefer fewer readings" pattern.                         | Pass   |
| Preselected or hidden add-ons               | Two products, each bought only by an explicit tap; nothing preselected.                                   | Pass   |
| Hidden renewal terms                        | Every subscription row carries auto-renewal, period, price, cancellation path, and "no minimum term".     | Pass   |
| Buried Restore / Manage Subscription        | Both are in the Shop and in Settings, at the same visual weight as purchase controls.                     | Pass   |
| Implying paid readings are better           | Copy states purchases add readings and never change what a reading says; Reveal has no paid label.        | Pass   |
| Nagging after a failure                     | Failure copy tells the player not to buy again and that delivery retries by itself.                       | Pass   |
| Double-charge risk framing                  | `deliveryFailureMessage` never suggests repurchasing; the unmatched case says buying again charges twice. | Pass   |
| Fake progress or pressure to subscribe      | The allowance line states the spend order factually and offers no upsell.                                 | Pass   |

Automated coverage for this table lives in `apps/mobile/src/iap/shop-catalog.test.ts`, which asserts the neutral cancellation phase, the no-repurchase failure wording, the eligibility-gated trial sentence, and the absence of an app-invented currency.

## Required states to review on device

Run each row in English and in the length-expanded pseudo-locale, on the smallest supported iPhone and on iPad in split view, with VoiceOver and Dynamic Type at an accessibility size.

| ID      | State                                                           | Status  |
| ------- | --------------------------------------------------------------- | ------- |
| P10-C01 | Shop with both products loaded and priced                       | NOT RUN |
| P10-C02 | Pack purchase success, allowance updates without relaunch       | NOT RUN |
| P10-C03 | Subscription purchase success, 11-draw day then pack credit     | NOT RUN |
| P10-C04 | Purchase cancelled by the player                                | NOT RUN |
| P10-C05 | Ask to Buy pending, then approved                               | NOT RUN |
| P10-C06 | Purchase accepted by Apple while offline from Fortuneness       | NOT RUN |
| P10-C07 | Restore Purchases with nothing to restore                       | NOT RUN |
| P10-C08 | Restore Purchases after reinstall with an active subscription   | NOT RUN |
| P10-C09 | Manage Subscription destination opens and returns               | NOT RUN |
| P10-C10 | Payments restricted by Screen Time                              | NOT RUN |
| P10-C11 | Storefront change while the Shop is open                        | NOT RUN |
| P10-C12 | Product unavailable in the active storefront                    | NOT RUN |
| P10-C13 | Expired subscriber keeps unlocked cards and the base daily draw | NOT RUN |
| P10-C14 | Account with `commerceReviewRequired` set                       | NOT RUN |
| P10-C15 | Non-English storefront price, period, and offer rendering       | NOT RUN |

Every row needs the build, device, iOS version, tester, date, and result before Phase 10 can be called accepted. The Mac/Xcode and App Store Sandbox gate carried over from Phase 9 still applies: nothing in this repository can exercise a real StoreKit transaction on Windows.

## Editorial sign-off

| Item                                              | Reviewer | Date | Result  |
| ------------------------------------------------- | -------- | ---- | ------- |
| Benefit descriptions match server behavior        |          |      | NOT RUN |
| Disclosure sentences match App Store requirements |          |      | NOT RUN |
| No urgency, guilt, or superiority framing         |          |      | NOT RUN |
| Failure and refund copy is accurate and calm      |          |      | NOT RUN |
