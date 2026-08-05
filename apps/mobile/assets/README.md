# Mobile assets

The Phase 2 Google ADC proofs live in `tools/card-assets/source` and are registered in `tools/card-assets/manifest.json`. During the visual proof, the mobile fixture imports each registered source directly so there is only one tracked binary and Metro still bundles it locally. A later locked normalization pass may produce dedicated shipping assets after all three cards pass real-device review.

Card labels, symbols, frames, orientation, and reading text remain code-rendered. The final app icon and launch mark remain separate production assets.
