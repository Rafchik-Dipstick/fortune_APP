# Fortuneness IAP Expo module

StoreKit 2 local Expo module for Fortuneness commerce (spec section 7.2).

- `ios/FortunenessIapModule.swift` starts the `Transaction.updates` listener
  at module creation and keeps it alive for the process lifetime; only
  StoreKit-verified transactions cross the boundary, always carrying their
  signed JWS representation for server verification.
- `src/FortunenessIapModule.ts` exposes products, purchase with the
  server-issued `appAccountToken`, current entitlements, unfinished
  transactions, explicit finish, explicit `AppStore.sync()` for Restore
  Purchases only, and the manage-subscriptions sheet. Every function degrades
  safely when the native module is absent (Expo Go, simulator without the
  dev build, non-Apple platforms).
- The delivery loop lives in `apps/mobile/src/iap/commerce-delivery.ts`:
  transactions are finished only after the server accepts delivery with
  `deliveryAccepted` and `safeToFinish` both true.

The Swift target compiles only in the Mac/Xcode development build. The
Phase 0 Xcode StoreKit-configuration and App Store Sandbox spike remains the
external gate for exercising the distinct trust paths end to end; until it
runs on a Mac this module is authored but unverified against a device.
