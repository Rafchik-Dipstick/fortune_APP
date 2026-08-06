# Fortuneness Game Center module

This iOS-only local Expo module owns the GameKit authentication handler, system presentation bridge, authentication-change events, persistent scoped-ID signal, restriction flags, and identity-verification proof retrieval.

The TypeScript wrapper uses an optional native-module lookup so an accidental Expo Go launch produces the explicit `UNSUPPORTED` state rather than a module-load crash. A development build is required for the native implementation.

Native build verification remains a setup gate:

1. Regenerate the iOS project/development client after native changes.
2. Confirm the App ID and provisioning profile have Game Center enabled.
3. Inspect the generated entitlements and signed IPA for `com.apple.developer.game-center = true`.
4. Exercise authentication, system sign-in presentation, persistent IDs, proof retrieval, restrictions, and player switching on a physical iPhone and iPad.
