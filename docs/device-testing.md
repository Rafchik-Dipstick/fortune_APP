# Testing on a device: Game Center and purchases

Scope: getting a development build onto an iPhone and exercising the two features that cannot be faked — Game Center sign-in and In-App Purchase. Everything here needs an Apple Developer account; none of it needs a Mac unless noted.

Start from [local development](local-development.md) with the API and Metro already running.

## 1. Unblock the build: Game Center capability

`plugins/with-game-center.cjs` sets the `com.apple.developer.game-center` entitlement, so the App ID has to grant it. EAS registers the identifier during the first build but does not enable that capability, which fails the build with:

```
Provisioning profile "*[expo] app.fortuneness.dev2 AdHoc ..." doesn't include the Game Center capability.
```

1. Open <https://developer.apple.com/account/resources/identifiers/list>.
2. Select `app.fortuneness.dev2`.
3. Tick **Game Center**, then **Save**.

The development identifier is `app.fortuneness.dev2` rather than `app.fortuneness.dev` because the
original one was consumed by an App Store Connect app record that was later deleted. Apple never
releases a bundle identifier once a record has claimed it, so `app.fortuneness.dev` can no longer
back an app record and is unusable for both Game Center proofs and In-App Purchase. Never delete
the record for a development identifier; it cannot be recreated.

EAS caches the provisioning profile, so it must be reissued or the next build fails identically:

```sh
cd apps/mobile
npx eas-cli@latest credentials -p ios
```

Choose the **development** profile, then the provisioning profile, then delete it. The next build generates a fresh one that carries the capability.

## 2. Register the iPhone

`eas.json` uses `distribution: "internal"`, which is ad hoc: a build only installs on devices whose UDID is in the profile. Register before rebuilding, or the build succeeds and installs on nothing.

```sh
npx eas-cli@latest device:create
```

Follow the link on the phone and install the profile. Then build:

```sh
npx eas-cli@latest build --profile development --platform ios
```

Adding a device later means reissuing the provisioning profile again, exactly as in step 1.

## 3. Game Center sign-in

The client asks Game Center for an identity proof and the API verifies it against Apple's public key.

- Use a **physical device**. Identity verification is not dependable on the Simulator.
- Sign in on the phone: **Settings → Game Center**.
- `APP_BUNDLE_ID` in `apps/api/.env` must equal the build's bundle identifier. Both are `app.fortuneness.dev2`; [game-center-proof.ts](../apps/api/src/auth/game-center-proof.ts) rejects the proof outright when they differ.
- An **App Store Connect app record must exist** for that identifier. Without one, authentication still succeeds but `fetchItems(forIdentityVerificationSignature:)` fails with `GKErrorDomain 15` (`gameUnrecognized`) before any request reaches the API.
- The phone reaches the API over the LAN address written by `dev:setup`. Allow Node through the Windows firewall on a private network for ports 3000 and 8081.
- The API fetches Apple's signing certificate on demand, so it needs outbound HTTPS to `static.gc.apple.com` and `cacerts.digicert.com`. Those are the only hosts its egress allowlist permits.
- A proof is valid for 300 seconds. A phone whose clock has drifted fails here.

Watch the API log while signing in: a rejected proof names which check failed.

## 4. Purchases

The server verifies a transaction against **vendored Apple root certificates**, entirely offline. No App Store Connect API key is needed to buy something and be credited — that key only powers reconciliation and refund lookups. Pick whichever route fits.

### Route A — Xcode StoreKit configuration (fastest, needs a Mac)

No App Store Connect setup at all. Add a StoreKit configuration file in Xcode, define the two products, and set `APPLE_IAP_ENVIRONMENT=XCODE` in `apps/api/.env`. Purchases resolve locally and instantly, which is the quickest way to exercise the shop, the credit ledger, and delivery.

### Route B — Apple sandbox (no Mac)

1. **App Store Connect app record** for `app.fortuneness.dev2`. Products belong to an app record, so one must exist for this bundle identifier.
2. **Sign the Paid Applications Agreement** under Business. Products silently fail to load without it, which looks like an app bug.
3. **Create the products** to match `apps/api/.env`:

   | Env var                              | Default                              | Type                        |
   | ------------------------------------ | ------------------------------------ | --------------------------- |
   | `IAP_FORTUNE_PACK_10_PRODUCT_ID`     | `app.fortuneness.fortunepack10`      | Consumable                  |
   | `IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID` | `app.fortuneness.oracleplus.monthly` | Auto-Renewable Subscription |

   Either name them exactly this, or change the env vars to whatever you created. The client reads both from the server, so they only have to agree in one place.

4. **Sandbox tester**: App Store Connect → Users and Access → Sandbox → Testers.
5. **On the phone**: Settings → Developer → Sandbox Apple Account, and sign in as that tester. Do not sign out of your real Apple ID in the App Store.
6. Leave `APPLE_IAP_ENVIRONMENT=SANDBOX` in `apps/api/.env`.

Sandbox subscriptions renew on an accelerated clock — a month lasts a few minutes — which makes expiry and renewal reachable in one sitting.

## 5. What cannot work against a laptop

| Feature                           | Why                                                                                                              | Way around it                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Store Server Notifications V2 | Apple must POST to a public HTTPS URL, so renewals, refunds, expiry, and revocations never arrive                | A tunnel (`cloudflared`, `ngrok`) pointed at port 3000, with that URL set in App Store Connect → App Information → App Store Server Notifications; or test against deployed Railway |
| Reconciliation job                | Needs `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY_BASE64` from an App Store Server API key | Create the key under Users and Access → Integrations → In-App Purchase, then fill those three variables                                                                             |

Without notifications, a purchase still applies: the client verifies with the server directly. What is missing is everything Apple pushes _afterwards_.

## 6. Known bugs that will affect what you see

These are confirmed and still unfixed, so they are expected rather than new discoveries:

- **Refunding one subscription period permanently kills an active subscription.** [allowance.ts](../apps/api/src/fortune/allowance.ts) gates on the aggregate `revokedAt`, so a single refund denies all subscriber benefits even while the current period is paid and renewing.
- **Billing grace period never becomes usable**, because the branch requires a stored status enum that is only recomputed when Apple sends an event.
- **A charged-but-undelivered purchase is not retried within a session.** Reconciliation runs once when the shop mounts and swallows its error, so a purchase the server never received stays stuck until the app restarts.

Related: [local development](local-development.md), [database operations runbook](database-operations-runbook.md).
