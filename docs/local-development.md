# Running Fortuneness locally

Scope: bringing the API, the database, and the Expo dev server up on a development machine so the app can be exercised by hand.

## One-time setup

```sh
corepack npm run dev:setup
```

That is idempotent and does four things:

1. Writes `apps/api/.env` from `.env.example`, generating the eight 32-byte keyrings the API refuses to start without. Existing files are left alone; pass `--force` through to regenerate.
2. Creates the local `fortuneness` database named in `DATABASE_URL`. It refuses any host that is not loopback.
3. Applies every migration with `prisma migrate deploy`.
4. Seeds the 78-card release catalog and its 624 English templates.
5. Writes `apps/mobile/.env` with `EXPO_PUBLIC_API_URL` pointed at this machine's LAN address.

Both `.env` files are gitignored. The generated keys protect a local database that holds nothing real; they are not credentials for any deployed environment.

Prerequisite: a running PostgreSQL 17 whose superuser matches the `DATABASE_URL` in `apps/api/.env.example` (`postgres:postgres@localhost:5432`). Edit that URL first if yours differs.

## Every session

Two terminals, because both processes are long-lived.

```sh
corepack npm run dev:api        # http://localhost:3000, restarts on save
```

```sh
corepack npm run dev:mobile     # Metro on http://localhost:8081
```

Confirm the API is healthy before touching the app:

```sh
curl http://localhost:3000/health
# {"checks":{"database":"ready","process":"ready"},"status":"ready"}
```

## Connecting a device

Expo Go cannot run this app. Game Center and StoreKit 2 are local Swift Expo modules, so a **development build** is required, and building one needs macOS or EAS Build.

From a Mac with Xcode:

```sh
corepack npm run ios --workspace @fortuneness/mobile
```

Otherwise, a cloud build installed over the air. **Every EAS command runs from `apps/mobile`, never the repository root.** The root has no Expo config, so `eas` there generates a stray `eas.json` and offers to create a project bound to the wrong directory:

```sh
cd apps/mobile
npx eas-cli@latest init      # once — creates the project under the pinned owner
npx eas-cli@latest build --profile development --platform ios
```

Use `eas-cli@latest` rather than a globally installed `eas`: `eas.json` pins `cli.version` to `>= 21.5.0`, and an older global CLI fails that check.

`app.config.ts` pins `owner`, so EAS always resolves the same account. Because it is a _dynamic_ TypeScript config, EAS cannot write `extra.eas.projectId` into it — `eas init` prints the id and it has to be pasted in by hand:

```ts
extra: {
  ...config.extra,
  eas: { projectId: '<the id eas init prints>' },
},
```

Install the resulting build once, then it loads JavaScript from the Metro server above for every subsequent change.

The phone must reach this machine, so `EXPO_PUBLIC_API_URL` is a LAN address rather than `localhost` — on the phone, `localhost` is the phone. Re-run the detector whenever the network changes:

```sh
corepack npm run dev:env --workspace @fortuneness/mobile -- --force
```

It prefers private ranges and ignores VPN adapters. Pass `--host=<address>` when the guess is wrong. The API already listens on `0.0.0.0`, but a Windows firewall prompt for Node on ports 3000 and 8081 has to be allowed on a private network.

## What does not work locally

| Area                    | Why                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchases               | Needs a StoreKit configuration in Xcode or a sandbox Apple ID; `APPLE_IAP_*` in `.env` is deliberately blank, and the API reads blank as "not configured". |
| App Store notifications | Apple must reach a public URL; the webhook cannot be delivered to a laptop.                                                                                |
| Game Center sign-in     | Requires a real device signed into Game Center with the app's bundle identifier.                                                                           |

Everything else — drawing, revealing, the archive, the collection, settings, reminders, account deletion — runs entirely against the local API.

## Resetting

```sh
corepack npm run db:seed --workspace @fortuneness/api      # re-seed content only
```

To start from an empty database, drop `fortuneness` in psql and re-run `corepack npm run dev:setup`.

Related: [database operations runbook](database-operations-runbook.md) for the isolated `test:db` harness, which generates and drops its own database and never touches this one.
