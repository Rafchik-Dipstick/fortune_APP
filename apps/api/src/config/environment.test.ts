import { describe, expect, it } from 'vitest';

import { InvalidApiEnvironmentError, parseApiEnvironment } from './environment.js';

const databaseUrl = 'postgresql://postgres:postgres@localhost:5432/fortuneness';

describe('parseApiEnvironment', () => {
  it('applies safe local defaults and normalizes explicit origins', () => {
    expect(
      parseApiEnvironment({
        DATABASE_URL: databaseUrl,
        CORS_ORIGINS: 'http://localhost:8081, https://preview.fortuneness.app',
      }),
    ).toEqual({
      corsOrigins: ['http://localhost:8081', 'https://preview.fortuneness.app'],
      databaseUrl,
      logLevel: 'info',
      nodeEnvironment: 'development',
      port: 3000,
      trustProxyHops: 0,
    });
  });

  it('parses bounded integer settings', () => {
    const environment = parseApiEnvironment({
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
});
