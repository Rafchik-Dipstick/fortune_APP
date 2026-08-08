import { type ApiEnvironment, parseApiEnvironment } from './environment.js';

const encodedKey = Buffer.alloc(32, 7).toString('base64');
const keyRing = JSON.stringify({ v1: encodedKey });

const baseEnvironment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/fortuneness',
  APP_BUNDLE_ID: 'app.fortuneness.test',
  APPLE_IDENTITY_HMAC_KEYS_JSON: keyRing,
  APPLE_IDENTITY_CURRENT_KEY_VERSION: 'v1',
  JWT_ACCESS_KEYS_JSON: keyRing,
  JWT_ACCESS_CURRENT_KEY_VERSION: 'v1',
  JWT_ISSUER: 'fortuneness-api-test',
  JWT_AUDIENCE: 'fortuneness-mobile-test',
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
});

export function createTestApiEnvironment(overrides: Partial<ApiEnvironment> = {}): ApiEnvironment {
  return { ...baseEnvironment, ...overrides };
}
