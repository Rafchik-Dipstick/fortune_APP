# Fortuneness

Fortuneness is an iPhone and iPad tarot-inspired daily reflection app. This repository contains the Expo mobile app, Express API, shared contracts, versioned fortune content, and card-asset tooling.

The canonical requirements are in [`FORTUNENESS_SPEC.md`](./FORTUNENESS_SPEC.md). Build, verification, and deployment history is maintained in [`DEPLOY_BOOK.md`](./DEPLOY_BOOK.md).

## Prerequisites

- Node.js 24 LTS; `.nvmrc` records the selected patch version.
- npm 11; `packageManager` records the selected package-manager version.
- Mac/Xcode and a physical iOS device for Game Center, StoreKit, signed entitlement, and native build verification.
- PostgreSQL for API work once the database phase begins.

Expo Go is not a supported runtime because Fortuneness uses local Swift modules for Game Center and StoreKit 2.

## Repository checks

```sh
corepack npm ci
corepack npm run check
```

Corepack resolves the exact npm version from `packageManager`. Individual gates are available as `format:check`, `lint`, `config:check`, `typecheck`, `test`, `content:validate`, `asset:validate`, and `build`.

## Workspace layout

```text
apps/api                    Express API (scaffolded in Phase 1)
apps/mobile                 Expo Router iOS/iPadOS app (scaffolded in Phase 1)
packages/api-contracts      Zod request and response schemas
packages/shared-types       Dependency-free shared domain types
packages/fortune-content    Versioned fortune content and validation
tools/card-assets           Card illustration manifest and asset QA
```
