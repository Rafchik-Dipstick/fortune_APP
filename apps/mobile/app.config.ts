import type { ConfigContext, ExpoConfig } from 'expo/config';

export const buildProfiles = ['development', 'preview', 'production'] as const;
const brandMarkPath = '../../tools/brand-assets/source/fortuneness-mark.png';

export type BuildProfile = (typeof buildProfiles)[number];

export function resolveBuildProfile(value: string | undefined): BuildProfile {
  if (value === 'preview' || value === 'production') {
    return value;
  }

  return 'development';
}

export function resolveConfiguredBuildProfile(
  iosBuildProfile: string | undefined,
  easBuildProfile: string | undefined,
): BuildProfile {
  return resolveBuildProfile(iosBuildProfile?.trim() || easBuildProfile);
}

export function supportedLocalesForProfile(profile: BuildProfile): readonly string[] {
  return profile === 'production' ? ['en'] : ['en', 'en-XA'];
}

export function resolveBundleIdentifier(
  profile: BuildProfile,
  configuredIdentifier: string | undefined,
): string {
  const normalizedIdentifier = configuredIdentifier?.trim();
  if (normalizedIdentifier) {
    return normalizedIdentifier;
  }

  if (profile === 'production') {
    throw new Error(
      'APP_BUNDLE_ID is required for production after the Phase 0 bundle identifier is confirmed.',
    );
  }

  return profile === 'preview' ? 'app.fortuneness.preview' : 'app.fortuneness.dev2';
}

/**
 * Fortuneness collects no advertising identifier, runs no third-party
 * analytics, and never tracks across apps or websites, so the manifest
 * declares no tracking domains and no tracking purposes. The declared data
 * types are the ones the app genuinely sends to its own backend, and the
 * required-reason APIs are those the storage stack touches.
 *
 * The wording here is the source of truth for the App Store Connect App
 * Privacy answers recorded in docs/app-privacy-worksheet.md.
 */
const privacyManifests: NonNullable<NonNullable<ExpoConfig['ios']>['privacyManifests']> = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [
    {
      // The Sign in with Apple subject identifier, stored only as a digest, is
      // what ties readings to an account.
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
    {
      // In-app purchase history is required to grant and audit entitlements.
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePurchaseHistory',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
    {
      // The reading archive and collection are the player's own content.
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
  ],
  NSPrivacyAccessedAPITypes: [
    {
      // expo-sqlite and the bundled card art read and write app-owned files.
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
      NSPrivacyAccessedAPITypeReasons: ['C617.1'],
    },
    {
      // React Native and Expo modules keep their own settings in UserDefaults.
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    },
    {
      // The local reading cache checks free space before writing.
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
      NSPrivacyAccessedAPITypeReasons: ['E174.1'],
    },
  ],
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = resolveConfiguredBuildProfile(
    process.env.IOS_BUILD_PROFILE,
    process.env.EAS_BUILD_PROFILE,
  );
  const supportedLocales = supportedLocalesForProfile(profile);
  const bundleIdentifier = resolveBundleIdentifier(profile, process.env.APP_BUNDLE_ID);

  return {
    ...config,
    name: 'Fortuneness',
    slug: 'fortuneness',
    // Pinned so an EAS command can never bind this app to whichever account
    // happens to be logged in. Fortuneness is its own project under this
    // account, unrelated to anything else published there.
    owner: 'infinityenglish',
    version: '0.2.0',
    backgroundColor: '#0D0A1A',
    icon: brandMarkPath,
    platforms: ['ios'],
    orientation: 'default',
    scheme: 'fortuneness',
    userInterfaceStyle: 'dark',
    ios: {
      ...config.ios,
      bundleIdentifier,
      usesAppleSignIn: true,
      supportsTablet: true,
      requireFullScreen: false,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDevelopmentRegion: 'en',
        CFBundleLocalizations: supportedLocales,
        // Declared false because the binary reaches for no encryption of its
        // own: transport security and the keychain are the operating system's,
        // and expo-crypto is used only for random identifiers and SHA-256
        // digests, which are not encryption. The AES-GCM, HMAC, and RSA work
        // this product depends on runs server side and never ships here.
        // Without the key, App Store Connect asks the export-compliance
        // question again on every upload.
        ITSAppUsesNonExemptEncryption: false,
      },
      privacyManifests,
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#0D0A1A',
          image: brandMarkPath,
          imageWidth: 180,
          resizeMode: 'contain',
        },
      ],
      [
        'expo-localization',
        {
          supportedLocales: {
            ios: supportedLocales,
          },
          supportsRTL: false,
        },
      ],
      'expo-secure-store',
      'expo-apple-authentication',
      'expo-sqlite',
      [
        'expo-audio',
        {
          microphonePermission: false,
          recordAudioAndroid: false,
          enableBackgroundPlayback: false,
          enableBackgroundRecording: false,
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.4',
          },
        },
      ],
      './plugins/with-local-notifications-only.cjs',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        // A dynamic config cannot be written by `eas init`, so the identifier
        // of https://expo.dev/accounts/infinityenglish/projects/fortuneness is
        // recorded here by hand. It pairs with `owner` above: together they are
        // what stops a build from resolving to some other account's project.
        projectId: 'dd4a8f29-b320-4533-afb0-dd4aff873073',
      },
    },
  };
};
