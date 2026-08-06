import { describe, expect, it } from 'vitest';

import { InvalidApiEnvironmentError, parseApiEnvironment } from './environment.js';

const databaseUrl = 'postgresql://postgres:postgres@localhost:5432/fortuneness';
const encodedKey = Buffer.alloc(32, 7).toString('base64');
const keyRing = JSON.stringify({ v1: encodedKey, v0: Buffer.alloc(32, 6).toString('base64') });
const validAuthenticationEnvironment = {
  APP_BUNDLE_ID: 'app.fortuneness.dev',
  GAME_CENTER_IDENTITY_HMAC_KEYS_JSON: keyRing,
  GAME_CENTER_IDENTITY_CURRENT_KEY_VERSION: 'v1',
  JWT_ACCESS_KEYS_JSON: keyRing,
  JWT_ACCESS_CURRENT_KEY_VERSION: 'v1',
  JWT_ISSUER: 'fortuneness-api',
  JWT_AUDIENCE: 'fortuneness-mobile',
  REFRESH_TOKEN_HMAC_KEYS_JSON: keyRing,
  REFRESH_TOKEN_CURRENT_KEY_VERSION: 'v1',
  REFRESH_REPLAY_ENCRYPTION_KEYS_JSON: keyRing,
  REFRESH_REPLAY_CURRENT_KEY_VERSION: 'v1',
  APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON: keyRing,
  APP_ACCOUNT_TOKEN_HMAC_CURRENT_KEY_VERSION: 'v1',
  APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON: keyRing,
  APP_ACCOUNT_TOKEN_ENCRYPTION_CURRENT_KEY_VERSION: 'v1',
  HISTORY_CURSOR_HMAC_KEYS_JSON: keyRing,
  HISTORY_CURSOR_CURRENT_KEY_VERSION: 'v1',
} as const;

describe('parseApiEnvironment', () => {
  it('applies safe local defaults and normalizes explicit origins', () => {
    const environment = parseApiEnvironment({
      ...validAuthenticationEnvironment,
      DATABASE_URL: databaseUrl,
      CORS_ORIGINS: 'http://localhost:8081, https://preview.fortuneness.app',
    });

    expect(environment).toMatchObject({
      corsOrigins: ['http://localhost:8081', 'https://preview.fortuneness.app'],
      databaseUrl,
      logLevel: 'info',
      nodeEnvironment: 'development',
      port: 3000,
      trustProxyHops: 0,
    });
    expect(environment.authentication).toMatchObject({
      bundleId: 'app.fortuneness.dev',
      gameCenterPublicKeyHosts: ['static.gc.apple.com'],
      gameCenterCertificateHosts: ['cacerts.digicert.com'],
      gameCenterProofMaxAgeSeconds: 300,
      gameCenterProofClockSkewSeconds: 60,
      jwtAccessTtlSeconds: 900,
      refreshTokenTtlDays: 30,
    });
    expect(environment.authentication.gameCenterIdentityKeys.currentVersion).toBe('v1');
    expect(environment.authentication.gameCenterIdentityKeys.keys['v1']).toEqual(
      Buffer.alloc(32, 7),
    );
    expect(environment.archive.historyCursorHmacKeys.currentVersion).toBe('v1');
    expect(environment.archive.historyCursorHmacKeys.keys['v1']).toEqual(Buffer.alloc(32, 7));
  });

  it('parses bounded integer settings', () => {
    const environment = parseApiEnvironment({
      ...validAuthenticationEnvironment,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
      PORT: '4310',
      TRUST_PROXY: '2',
      LOG_LEVEL: 'debug',
    });

    expect(environment.port).toBe(4310);
    expect(environment.trustProxyHops).toBe(2);
    expect(environment.logLevel).toBe('debug');
  });

  it('requires an explicit positive proxy hop count in production', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        TRUST_PROXY: '0',
      }),
    ).toThrow(/TRUST_PROXY/);
  });

  it('rejects malformed database and CORS values without echoing them', () => {
    const invalidDatabaseUrl = 'not-a-secret-bearing-database-url';
    const invalidCorsOrigin = 'https://example.com/private/path';

    try {
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: invalidDatabaseUrl,
        CORS_ORIGINS: invalidCorsOrigin,
      });
      throw new Error('Expected environment parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidApiEnvironmentError);
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).toContain('CORS_ORIGINS');
      expect(String(error)).not.toContain(invalidDatabaseUrl);
      expect(String(error)).not.toContain(invalidCorsOrigin);
    }
  });

  it('rejects malformed or mismatched keyrings without exposing secret values', () => {
    const malformedKey = 'not-a-valid-secret';

    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_KEYS_JSON: JSON.stringify({ v1: malformedKey }),
      }),
    ).toThrow(/JWT_ACCESS_KEYS_JSON/);
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_CURRENT_KEY_VERSION: 'missing',
      }),
    ).toThrow(/JWT_ACCESS_CURRENT_KEY_VERSION/);
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        HISTORY_CURSOR_CURRENT_KEY_VERSION: 'missing',
      }),
    ).toThrow(/HISTORY_CURSOR_CURRENT_KEY_VERSION/);

    try {
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_KEYS_JSON: JSON.stringify({ v1: malformedKey }),
      });
    } catch (error) {
      expect(String(error)).not.toContain(malformedKey);
    }
  });
});
