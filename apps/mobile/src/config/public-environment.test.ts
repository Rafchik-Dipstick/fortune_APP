import { describe, expect, it } from 'vitest';

import { parsePublicEnvironment } from './public-environment';

describe('public mobile environment', () => {
  it('permits local HTTP only in development', () => {
    expect(
      parsePublicEnvironment({
        EXPO_PUBLIC_APP_ENV: 'development',
        EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000/',
      }).apiUrl,
    ).toBe('http://127.0.0.1:3000');
    expect(() =>
      parsePublicEnvironment({
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'http://api.example.com',
      }),
    ).toThrow('apiUrl must use HTTPS');
  });

  it('rejects credentials and non-HTTP schemes', () => {
    expect(() =>
      parsePublicEnvironment({ EXPO_PUBLIC_API_URL: 'https://user:secret@example.com' }),
    ).toThrow('without credentials');
    expect(() => parsePublicEnvironment({ EXPO_PUBLIC_SUPPORT_URL: 'file:///support' })).toThrow(
      'HTTP(S)',
    );
  });

  it('rejects unknown environment labels instead of weakening HTTPS policy', () => {
    expect(() => parsePublicEnvironment({ EXPO_PUBLIC_APP_ENV: 'prod' })).toThrow(
      'EXPO_PUBLIC_APP_ENV',
    );
  });
});
