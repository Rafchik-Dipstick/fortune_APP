# Fortuneness mobile

This is the Expo SDK 57 iPhone/iPad workspace. It uses Expo Router and development builds; Expo Go is not supported because Game Center and StoreKit 2 require local Swift Expo modules.

## Local configuration

Copy `.env.example` to `.env` and keep only public, non-secret mobile values there. Production and preview API URLs must come from their matching EAS environments. Never place API, Apple, database, or encryption secrets in an `EXPO_PUBLIC_` variable.

```sh
corepack npm run config:check --workspace @fortuneness/mobile
corepack npm run typecheck --workspace @fortuneness/mobile
corepack npm run start --workspace @fortuneness/mobile
```

`APP_BUNDLE_ID` intentionally fails closed for production until the Phase 0 owner decision is recorded. Development and preview use isolated placeholder identifiers and do not prove the final Game Center entitlement.

The `en-XA` length-expanded pseudo-locale is declared only in development/preview profiles. Set `EXPO_PUBLIC_LOCALE_OVERRIDE=en-XA` locally to render it. Production hard-disables pseudo-locale generation and declares only English.
