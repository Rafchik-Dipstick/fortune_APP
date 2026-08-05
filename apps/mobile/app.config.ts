import type { ConfigContext, ExpoConfig } from 'expo/config';

export const buildProfiles = ['development', 'preview', 'production'] as const;

export type BuildProfile = (typeof buildProfiles)[number];

export function resolveBuildProfile(value: string | undefined): BuildProfile {
  if (value === 'preview' || value === 'production') {
    return value;
  }

  return 'development';
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

  return profile === 'preview' ? 'app.fortuneness.preview' : 'app.fortuneness.dev';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = resolveBuildProfile(process.env.EAS_BUILD_PROFILE);
  const supportedLocales = supportedLocalesForProfile(profile);
  const bundleIdentifier = resolveBundleIdentifier(profile, process.env.APP_BUNDLE_ID);

  return {
    ...config,
    name: 'Fortuneness',
    slug: 'fortuneness',
    version: '0.1.0',
    platforms: ['ios'],
    orientation: 'default',
    scheme: 'fortuneness',
    userInterfaceStyle: 'dark',
    ios: {
      ...config.ios,
      bundleIdentifier,
      supportsTablet: true,
      requireFullScreen: false,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDevelopmentRegion: 'en',
        CFBundleLocalizations: supportedLocales,
      },
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#0D0A1A',
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
      'expo-sqlite',
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
  };
};
