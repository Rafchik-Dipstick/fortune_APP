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
  APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON: keyRing,
  APP_STORE_NOTIFICATION_CURRENT_KEY_VERSION: 'v1',
} as const;

const appStorePrivateKey = Buffer.from(
  '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEH\n-----END PRIVATE KEY-----\n',
  'utf8',
).toString('base64');

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
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        HISTORY_CURSOR_CURRENT_KEY_VERSION: 'constructor',
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

  it('defaults commerce configuration closed with the documented products', () => {
    const environment = parseApiEnvironment({
      ...validAuthenticationEnvironment,
      DATABASE_URL: databaseUrl,
    });

    expect(environment.commerce).toMatchObject({
      appAppleId: null,
      appStoreServerApi: null,
      consumptionInfoEnabled: false,
      environment: 'SANDBOX',
      expectedSubscriptionBillingPlanType: null,
      fortunePack10ProductId: 'app.fortuneness.fortunepack10',
      notificationRawTtlDays: 90,
      oraclePlusMonthlyProductId: 'app.fortuneness.oracleplus.monthly',
    });
    expect(environment.commerce.notificationEncryptionKeys.currentVersion).toBe('v1');
  });

  it('requires complete App Store Server API credentials together', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
      }),
    ).toThrow(/APPLE_IAP_KEY_ID/);

    const environment = parseApiEnvironment({
      ...validAuthenticationEnvironment,
      DATABASE_URL: databaseUrl,
      APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
      APPLE_IAP_KEY_ID: '2X9R4HXF34',
      APPLE_IAP_PRIVATE_KEY_BASE64: appStorePrivateKey,
    });
    expect(environment.commerce.appStoreServerApi).toMatchObject({
      issuerId: '57246542-96fe-1a63-e053-0824d011072a',
      keyId: '2X9R4HXF34',
    });
    expect(environment.commerce.appStoreServerApi?.privateKeyPem).toContain('PRIVATE KEY');
  });

  it('rejects the local-only Xcode commerce environment in production', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        APPLE_IAP_ENVIRONMENT: 'XCODE',
        APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
        APPLE_IAP_KEY_ID: '2X9R4HXF34',
        APPLE_IAP_PRIVATE_KEY_BASE64: appStorePrivateKey,
      }),
    ).toThrow(/APPLE_IAP_ENVIRONMENT/);
  });

  it('requires App Store Server API credentials in production', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
      }),
    ).toThrow(/APPLE_IAP_ISSUER_ID/);
  });

  it('applies the documented hardening defaults', () => {
    const environment = parseApiEnvironment({
      ...validAuthenticationEnvironment,
      DATABASE_URL: databaseUrl,
    });

    expect(environment.deploymentEnvironment).toBe('local');
    expect(environment.requestTimeoutMs).toBe(15_000);
    expect(environment.outboundRequestTimeoutMs).toBe(5_000);
    expect(environment.database).toMatchObject({
      lockTimeoutMs: 5_000,
      poolMax: 10,
      statementTimeoutMs: 10_000,
    });
    expect(environment.rateLimits).toEqual({
      authenticationMax: 20,
      defaultMax: 120,
      drawMax: 30,
      webhookMax: 600,
      windowMs: 60_000,
    });
    expect(environment.observability).toEqual({
      errorReporting: null,
      metricsFlushIntervalMs: 60_000,
      release: null,
    });
  });

  it.each([
    ['staging', 'PRODUCTION'],
    ['staging', 'XCODE'],
    ['production', 'SANDBOX'],
    ['production', 'XCODE'],
    ['local', 'PRODUCTION'],
  ])('refuses %s commerce trust from the %s App Store environment', (deployment, commerce) => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        DEPLOYMENT_ENVIRONMENT: deployment,
        APPLE_IAP_ENVIRONMENT: commerce,
      }),
    ).toThrow(/APPLE_IAP_ENVIRONMENT/);
  });

  it('requires a named deployment when NODE_ENV is production', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
        APPLE_IAP_KEY_ID: '2X9R4HXF34',
        APPLE_IAP_PRIVATE_KEY_BASE64: appStorePrivateKey,
      }),
    ).toThrow(/DEPLOYMENT_ENVIRONMENT/);
  });

  it('requires error reporting before a production deployment starts', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'production',
        DEPLOYMENT_ENVIRONMENT: 'production',
        TRUST_PROXY: '1',
        APPLE_IAP_ENVIRONMENT: 'PRODUCTION',
        APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
        APPLE_IAP_KEY_ID: '2X9R4HXF34',
        APPLE_IAP_PRIVATE_KEY_BASE64: appStorePrivateKey,
      }),
    ).toThrow(/ERROR_REPORTING_DSN/);
  });

  it('parses a DSN into ingest coordinates without keeping the raw value', () => {
    const environment = parseApiEnvironment({
      ...validAuthenticationEnvironment,
      DATABASE_URL: databaseUrl,
      DEPLOYMENT_ENVIRONMENT: 'staging',
      ERROR_REPORTING_DSN: 'https://abc123@o1.ingest.example.com/42',
      ERROR_REPORTING_RELEASE: 'fortuneness-api@1.2.3',
    });

    expect(environment.observability.errorReporting).toEqual({
      envelopeUrl: 'https://o1.ingest.example.com/api/42/envelope/',
      host: 'o1.ingest.example.com',
      projectId: '42',
      publicKey: 'abc123',
    });
    expect(environment.observability.release).toBe('fortuneness-api@1.2.3');
  });

  it.each([
    'http://abc123@o1.ingest.example.com/42',
    'https://o1.ingest.example.com/42',
    'https://abc123@o1.ingest.example.com/',
    'https://abc123@o1.ingest.example.com/not-a-project',
    'not-a-url',
  ])('rejects the malformed DSN %s', (dsn) => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        ERROR_REPORTING_DSN: dsn,
      }),
    ).toThrow(/ERROR_REPORTING_DSN/);
  });

  it('orders the database, statement, and request deadlines so the innermost fails first', () => {
    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        DATABASE_LOCK_TIMEOUT_MS: '10000',
        DATABASE_STATEMENT_TIMEOUT_MS: '10000',
      }),
    ).toThrow(/DATABASE_LOCK_TIMEOUT_MS/);

    expect(() =>
      parseApiEnvironment({
        ...validAuthenticationEnvironment,
        DATABASE_URL: databaseUrl,
        DATABASE_STATEMENT_TIMEOUT_MS: '20000',
        REQUEST_TIMEOUT_MS: '15000',
      }),
    ).toThrow(/REQUEST_TIMEOUT_MS/);
  });

  it('rejects an out-of-range timeout, pool size, or rate limit', () => {
    for (const invalid of [
      { DATABASE_POOL_MAX: '0' },
      { DATABASE_POOL_MAX: '500' },
      { REQUEST_TIMEOUT_MS: '999' },
      { OUTBOUND_REQUEST_TIMEOUT_MS: '60000' },
      { RATE_LIMIT_WINDOW_MS: '0' },
      { RATE_LIMIT_MAX: '0' },
      { METRICS_FLUSH_INTERVAL_MS: '1000' },
    ]) {
      expect(() =>
        parseApiEnvironment({
          ...validAuthenticationEnvironment,
          DATABASE_URL: databaseUrl,
          ...invalid,
        }),
      ).toThrow(InvalidApiEnvironmentError);
    }
  });
});
