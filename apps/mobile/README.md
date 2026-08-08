# Fortuneness mobile

This is the Expo SDK 57 iPhone/iPad workspace. It uses Expo Router and development builds; StoreKit 2 still requires the local Swift Expo module.

## Local configuration

`corepack npm run dev:setup` from the repository root writes this workspace's `.env` with `EXPO_PUBLIC_API_URL` pointed at the machine's LAN address, and brings the API and its database up alongside it. See [docs/local-development.md](../../docs/local-development.md) for the whole loop, including how to get a development build onto a device.

Only public, non-secret mobile values belong in `.env`. Production and preview API URLs must come from their matching EAS environments. Never place API, Apple, database, or encryption secrets in an `EXPO_PUBLIC_` variable.

```sh
corepack npm run config:check --workspace @fortuneness/mobile
corepack npm run typecheck --workspace @fortuneness/mobile
corepack npm run start --workspace @fortuneness/mobile
```

`APP_BUNDLE_ID` intentionally fails closed for production until the Phase 0 owner decision is recorded. It is also the audience the API requires on Sign in with Apple identity tokens.

The `en-XA` length-expanded pseudo-locale is declared only in development/preview profiles. Use the session-only switch in Settings to compare it with English on one QA build, or set `EXPO_PUBLIC_LOCALE_OVERRIDE=en-XA` to start there. Production hard-disables the switch and pseudo-locale generation and declares only English.
