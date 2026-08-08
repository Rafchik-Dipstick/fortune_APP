import { describe, expect, it } from 'vitest';

import { parseApiEnvironment } from '../config/environment.js';
import {
  normalizeVerifiedTransaction,
  SignedTransactionVerificationError,
  type AppleTransactionPolicy,
  type JWSTransactionDecodedPayload,
} from './verification.js';

const productionPolicy: AppleTransactionPolicy = {
  acceptedEnvironments: ['PRODUCTION', 'SANDBOX'],
  expectedSubscriptionBillingPlanType: null,
  fortunePack10ProductId: 'app.fortuneness.fortunepack10',
  oraclePlusMonthlyProductId: 'app.fortuneness.oracleplus.monthly',
};

const stagingPolicy: AppleTransactionPolicy = {
  ...productionPolicy,
  acceptedEnvironments: ['SANDBOX'],
};

function payload(
  overrides: Partial<JWSTransactionDecodedPayload> = {},
): JWSTransactionDecodedPayload {
  return {
    transactionId: '2000000000000001',
    originalTransactionId: '2000000000000001',
    productId: 'app.fortuneness.fortunepack10',
    type: 'Consumable',
    purchaseDate: 1_760_000_000_000,
    signedDate: 1_760_000_000_500,
    environment: 'Production',
    ...overrides,
  };
}

describe('transaction environment acceptance', () => {
  it('accepts a sandbox transaction in production and records it as sandbox', () => {
    // App Review and TestFlight both purchase in the sandbox against the
    // production service. Refusing this is what fails review.
    const result = normalizeVerifiedTransaction(
      payload({ environment: 'Sandbox' }),
      'signed.jws.value',
      productionPolicy,
    );

    expect(result.environment).toBe('SANDBOX');
  });

  it('records a production transaction as production', () => {
    const result = normalizeVerifiedTransaction(payload(), 'signed.jws.value', productionPolicy);

    expect(result.environment).toBe('PRODUCTION');
  });

  it('never lets a sandbox purchase be recorded as a paid one', () => {
    const sandbox = normalizeVerifiedTransaction(
      payload({ environment: 'Sandbox' }),
      'signed.jws.value',
      productionPolicy,
    );
    const production = normalizeVerifiedTransaction(
      payload({ transactionId: '2000000000000002' }),
      'signed.jws.value',
      productionPolicy,
    );

    expect(sandbox.environment).not.toBe(production.environment);
  });

  it('refuses a production transaction on a staging deployment', () => {
    // Staging holds only sandbox trust; a real payment must never land there.
    expect(() =>
      normalizeVerifiedTransaction(payload(), 'signed.jws.value', stagingPolicy),
    ).toThrow(SignedTransactionVerificationError);
  });

  it('refuses an environment no deployment accepts', () => {
    expect(() =>
      normalizeVerifiedTransaction(
        payload({ environment: 'Xcode' }),
        'signed.jws.value',
        productionPolicy,
      ),
    ).toThrow(/not accepted by this deployment/u);
  });
});

describe('configured acceptance sets', () => {
  const appStorePrivateKey = Buffer.from(
    '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEH\n-----END PRIVATE KEY-----\n',
    'utf8',
  ).toString('base64');
  const encodedKey = Buffer.alloc(32, 7).toString('base64');
  const keyRing = JSON.stringify({ v1: encodedKey });
  const baseKeys = {
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
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/fortuneness',
    APP_BUNDLE_ID: 'fortuness.app',
  };

  it('pairs production with sandbox so App Review can purchase', () => {
    const environment = parseApiEnvironment({
      ...baseKeys,
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'production',
      TRUST_PROXY: '1',
      APPLE_IAP_ENVIRONMENT: 'PRODUCTION',
      APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
      APPLE_IAP_KEY_ID: '2X9R4HXF34',
      APPLE_IAP_PRIVATE_KEY_BASE64: appStorePrivateKey,
    });

    expect([...environment.commerce.acceptedEnvironments].sort()).toEqual([
      'PRODUCTION',
      'SANDBOX',
    ]);
    // The App Store Server API endpoint stays production-only.
    expect(environment.commerce.environment).toBe('PRODUCTION');
  });

  it('keeps staging on sandbox alone', () => {
    const environment = parseApiEnvironment({
      ...baseKeys,
      DEPLOYMENT_ENVIRONMENT: 'staging',
      APPLE_IAP_ENVIRONMENT: 'SANDBOX',
    });

    expect(environment.commerce.acceptedEnvironments).toEqual(['SANDBOX']);
  });
});
