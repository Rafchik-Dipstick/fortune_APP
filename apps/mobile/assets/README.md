# Mobile assets

The immutable Phase 2 Google ADC proofs live in `tools/card-assets/source` and are registered in `tools/card-assets/manifest.json`. Reviewed crop decisions live in `tools/card-assets/crop-plan.v1.json`; `corepack npm run asset:normalize -- --group <group>` creates the 1024 × 1536 RGB bundle candidates under `tools/card-assets/normalized` without replacing archival source checksums. The mobile fixture imports normalized candidates once their manifest entry exists so Expo device review exercises the cropped artwork.

Card labels, symbols, frames, orientation, and reading text remain code-rendered. The final app icon and launch mark remain separate production assets.

The unreviewed square brand-mark candidate lives at `tools/brand-assets/source/fortuneness-mark.png`, is registered separately from card art, and is used by the development Expo configuration as both the app-icon source and contained launch mark. It must pass masked physical-device review before its status can change from generated proof to approved production asset.
