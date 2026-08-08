# Testing on a device: Sign in with Apple and purchases

Scope: installing a development build on an iPhone and exercising Sign in with Apple and In-App Purchase. Start from [local development](local-development.md) with the API and Metro running.

## 1. Enable Sign in with Apple

`app.config.ts` enables `ios.usesAppleSignIn` and the `expo-apple-authentication` config plugin. The Apple App ID for the build bundle identifier must also have **Sign in with Apple** enabled.

1. Open <https://developer.apple.com/account/resources/identifiers/list>.
2. Select the development identifier (`app.fortuneness.dev2` by default).
3. Enable **Sign in with Apple**, configure it as the primary App ID, and save.
4. Reissue the EAS provisioning profile if it predates that capability:

```sh
cd apps/mobile
npx eas-cli@latest credentials -p ios
```

Choose the development profile and remove its provisioning profile. The next build generates one with the new entitlement. Never delete the App Store Connect record for a bundle identifier; Apple does not make the identifier reusable.

## 2. Register and build for the iPhone

The development profile uses ad hoc distribution, so register the device UDID before building:

```sh
npx eas-cli@latest device:create
npx eas-cli@latest build --profile development --platform ios
```

Adding a device later requires another provisioning-profile refresh.

## 3. Sign in with Apple

- Prefer a physical device for end-to-end entitlement and Keychain testing.
- `APP_BUNDLE_ID` in `apps/api/.env` must exactly equal the build bundle identifier. The API requires that value as the Apple JWT audience.
- Tap the native **Sign in with Apple** button. Fortuneness requests neither name nor email.
- The API verifies issuer, audience, signature, nonce, `iat`, and `exp` against Apple's fixed JWKS endpoint at `https://appleid.apple.com/auth/keys`.
- A presented token must be no more than 300 seconds old. Reusing an accepted token is rejected.
- The phone reaches the API through the LAN address written by `dev:setup`; allow ports 3000 and 8081 through the development-machine firewall.
- Confirm the signed app carries the `com.apple.developer.applesignin` entitlement.

Test all of these cases: first account creation, silent refresh-session restore after relaunch, local disconnect, selecting a different Apple Account, deletion reauthentication, and cancellation during the Apple sheet.

## 4. Purchases

The server verifies transactions against vendored Apple root certificates. An App Store Connect API key is needed for reconciliation and refund lookups, not ordinary client delivery.

### Route A — Xcode StoreKit configuration

On a Mac, add a StoreKit configuration with the two products and set `APPLE_IAP_ENVIRONMENT=XCODE` in `apps/api/.env`.

### Route B — Apple sandbox

1. Create or keep the App Store Connect app record for the build identifier.
2. Sign the Paid Applications Agreement.
3. Create products matching the API configuration:

   | Env var                              | Default                              | Type                        |
   | ------------------------------------ | ------------------------------------ | --------------------------- |
   | `IAP_FORTUNE_PACK_10_PRODUCT_ID`     | `app.fortuneness.fortunepack10`      | Consumable                  |
   | `IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID` | `app.fortuneness.oracleplus.monthly` | Auto-Renewable Subscription |

4. Create an App Store Connect sandbox tester.
5. On the phone, sign that tester in under Settings → Developer → Sandbox Apple Account.
6. Keep `APPLE_IAP_ENVIRONMENT=SANDBOX` in `apps/api/.env`.

The sandbox purchase account is separate from the Sign in with Apple application identity. Ownership remains bound through the server-issued `appAccountToken`.

## 5. Services that need public deployment

| Feature                           | Requirement                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| App Store Server Notifications V2 | A public HTTPS endpoint configured in App Store Connect, or a tunnel to local port 3000                        |
| Reconciliation job                | `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, and `APPLE_IAP_PRIVATE_KEY_BASE64` from an App Store Server API key |

Related: [local development](local-development.md), [database operations runbook](database-operations-runbook.md).
