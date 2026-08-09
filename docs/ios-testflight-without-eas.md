# Upload iOS builds without EAS Build

Fortuneness uses a manually triggered GitHub Actions workflow to generate the native iOS project, create a current App Store provisioning profile, archive the application on macOS, and upload the IPA directly to TestFlight. It does not create or consume an EAS cloud-build job.

## What is configured

The workflow is `.github/workflows/ios-testflight.yml`. It runs only when manually dispatched and uses the public repository's standard `macos-26` runner.

The following encrypted repository secrets contain the existing Apple credentials for `fortuness.app`:

- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `ASC_API_KEY_P8_BASE64`
- `ASC_KEY_ID`
- `ASC_ISSUER_ID`

The non-secret repository variables are:

- `APPLE_TEAM_ID=YGR53JLX36`
- `IOS_DISTRIBUTION_CERTIFICATE_ID=UB252MH78M`

GitHub does not expose Actions secrets to pull requests from forks. The release workflow is manual-only so an ordinary push or pull request cannot upload an Apple build.

The App Store Connect API key is an Admin key for Apple team `YGR53JLX36`. It is distinct from Railway's `SubscriptionKey_*.p8`, which remains limited to the In-App Purchase server API.

## Upload a build

1. Open the repository's **Actions** tab.
2. Select **iOS TestFlight**.
3. Select **Run workflow**, keep branch `main`, and leave `build_number` blank unless Apple requires a specific higher number.
4. Optionally enter TestFlight **What to Test** text.
5. Select **Run workflow**.

When `build_number` is blank, CI derives a positive build number from the workflow run and retry counters, starting above 1000. This avoids collisions with the previous EAS build numbers. The workflow uploads only to TestFlight; it does not submit the app for App Review or notify external testers.

After Transporter accepts the upload, App Store Connect still needs time to process the binary. Open App Store Connect, select Fortuneness, then TestFlight, and wait for the build to finish processing before assigning it to testers.

## What the workflow verifies while building

- Production profile selection does not depend on EAS CLI.
- The production bundle identifier is `fortuness.app`.
- Production API and legal URLs are compiled into the JavaScript bundle.
- Expo prebuild generates a fresh iOS project from `app.config.ts` and its config plugins.
- CocoaPods resolves the native dependency graph.
- Fastlane requests a fresh App Store profile tied to distribution certificate `UB252MH78M`; this prevents the old Game Center-era profile from silently omitting the Sign in with Apple entitlement.
- Xcode archives with manual App Store signing and the generated profile.
- Fastlane/Transporter uploads the resulting IPA directly to App Store Connect Apple ID `6799167588`.

The IPA and dSYM archive are retained as a GitHub Actions artifact for 14 days even when the upload step fails after the archive was created.

## Credential rotation

When the distribution certificate changes, replace the two `IOS_DISTRIBUTION_CERTIFICATE_*` secrets and the certificate-ID variable together. When the App Store Connect API key changes, replace all three `ASC_*` secrets together. Never commit a `.p8`, `.p12`, password, provisioning profile, or decoded secret.

The workflow deliberately regenerates the provisioning profile through Apple's API on every run. A capability change therefore does not require storing a new profile in GitHub.
