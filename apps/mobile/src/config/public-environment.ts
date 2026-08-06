export interface PublicEnvironment {
  apiUrl: string;
  appEnvironment: 'development' | 'preview' | 'production';
  privacyUrl: string;
  supportUrl: string;
  termsUrl: string;
}

function parseAppEnvironment(value: string | undefined): PublicEnvironment['appEnvironment'] {
  if (value === undefined || value === '' || value === 'development') {
    return 'development';
  }
  if (value === 'preview' || value === 'production') {
    return value;
  }
  throw new Error('EXPO_PUBLIC_APP_ENV must be development, preview, or production.');
}

function parseHttpUrl(name: string, value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials.`);
  }
  return url.toString().replace(/\/$/u, '');
}

export function parsePublicEnvironment(
  source: Record<string, string | undefined>,
): PublicEnvironment {
  const appEnvironment = parseAppEnvironment(source.EXPO_PUBLIC_APP_ENV);
  const environment: PublicEnvironment = {
    appEnvironment,
    apiUrl: parseHttpUrl(
      'EXPO_PUBLIC_API_URL',
      source.EXPO_PUBLIC_API_URL,
      'http://localhost:3000',
    ),
    privacyUrl: parseHttpUrl(
      'EXPO_PUBLIC_PRIVACY_URL',
      source.EXPO_PUBLIC_PRIVACY_URL,
      'https://fortuneness.app/privacy',
    ),
    termsUrl: parseHttpUrl(
      'EXPO_PUBLIC_TERMS_URL',
      source.EXPO_PUBLIC_TERMS_URL,
      'https://fortuneness.app/terms',
    ),
    supportUrl: parseHttpUrl(
      'EXPO_PUBLIC_SUPPORT_URL',
      source.EXPO_PUBLIC_SUPPORT_URL,
      'https://fortuneness.app/support',
    ),
  };
  if (appEnvironment !== 'development') {
    for (const [name, value] of [
      ['apiUrl', environment.apiUrl],
      ['privacyUrl', environment.privacyUrl],
      ['termsUrl', environment.termsUrl],
      ['supportUrl', environment.supportUrl],
    ] as const) {
      if (!value.startsWith('https://')) {
        throw new Error(`${name} must use HTTPS outside development.`);
      }
    }
  }
  return environment;
}

export const publicEnvironment = parsePublicEnvironment(process.env);
