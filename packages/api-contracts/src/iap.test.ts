import { describe, expect, it } from 'vitest';

import {
  iapCatalogResponseSchema,
  iapReconcileResponseSchema,
  iapTransactionRequestSchema,
  iapTransactionResponseSchema,
} from './iap.js';

const signedTransaction = `${'a'.repeat(24)}.${'b'.repeat(64)}.${'c'.repeat(24)}`;

const catalog = {
  products: [
    { productId: 'app.fortuneness.fortunepack10', productType: 'CONSUMABLE' },
    { productId: 'app.fortuneness.oracleplus.monthly', productType: 'AUTO_RENEWABLE_SUBSCRIPTION' },
  ],
  benefits: [
    {
      productId: 'app.fortuneness.fortunepack10',
      kind: 'PACK_CREDITS',
      units: 10,
      title: '10 Fortune Pack',
      description: 'Adds exactly 10 spendable draw credits after server verification.',
    },
    {
      productId: 'app.fortuneness.oracleplus.monthly',
      kind: 'SUBSCRIPTION_DAILY_FORTUNES',
      units: 10,
      title: 'Oracle+ Monthly',
      description: 'Adds 10 fortunes per eligible account day while verified active or in grace.',
    },
  ],
  gracePeriodPolicy: {
    enabled: true,
    description: 'Verified billing grace keeps subscriber benefits until the grace expiration.',
  },
  appAccountToken: 'cce93010-158e-4d65-bdd8-38672203a59b',
};

describe('IAP catalog contract', () => {
  it('accepts the allowlisted catalog with a purchase token', () => {
    expect(iapCatalogResponseSchema.parse(catalog)).toBeDefined();
  });

  it('rejects a benefit that names an unlisted product', () => {
    expect(
      iapCatalogResponseSchema.safeParse({
        ...catalog,
        benefits: [{ ...catalog.benefits[0], productId: 'app.fortuneness.unknown' }],
      }).success,
    ).toBe(false);
  });
});

describe('IAP transaction delivery contract', () => {
  it('accepts a compact JWS and rejects non-JWS payloads', () => {
    expect(iapTransactionRequestSchema.safeParse({ signedTransaction }).success).toBe(true);
    expect(iapTransactionRequestSchema.safeParse({ signedTransaction: 'not-a-jws' }).success).toBe(
      false,
    );
  });

  it('accepts applied and duplicate deliveries as success', () => {
    expect(
      iapTransactionResponseSchema.parse({
        transactionId: '2000000123456789',
        deliveryAccepted: true,
        safeToFinish: true,
        appliedNow: true,
        disposition: 'APPLIED',
      }),
    ).toBeDefined();
    expect(
      iapTransactionResponseSchema.parse({
        transactionId: '2000000123456789',
        deliveryAccepted: true,
        safeToFinish: true,
        appliedNow: false,
        disposition: 'ALREADY_APPLIED',
      }),
    ).toBeDefined();
  });

  it('never lets an other-owner delivery carry caller state', () => {
    expect(
      iapTransactionResponseSchema.safeParse({
        transactionId: '2000000123456789',
        deliveryAccepted: true,
        safeToFinish: true,
        appliedNow: false,
        disposition: 'DELIVERED_TO_OTHER_ACCOUNT',
        callerState: {
          subscription: {
            status: 'NONE',
            entitled: false,
            paidThrough: null,
            graceThrough: null,
          },
          spendablePackCredits: 0,
          commerceReviewRequired: false,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects an applied delivery that claims appliedNow false unsafely', () => {
    expect(
      iapTransactionResponseSchema.safeParse({
        transactionId: '2000000123456789',
        deliveryAccepted: true,
        safeToFinish: false,
        appliedNow: true,
        disposition: 'APPLIED',
      }).success,
    ).toBe(false);
  });
});

describe('IAP reconcile contract', () => {
  it('requires one unique disposition per submitted index', () => {
    const disposition = {
      index: 0,
      transactionId: '2000000123456789',
      deliveryAccepted: true,
      safeToFinish: true,
      appliedNow: false,
      disposition: 'ALREADY_APPLIED',
    } as const;

    expect(
      iapReconcileResponseSchema.safeParse({ dispositions: [disposition, disposition] }).success,
    ).toBe(false);
    expect(iapReconcileResponseSchema.parse({ dispositions: [disposition] })).toBeDefined();
  });

  it('keeps rejected items unfinished with a stable error code', () => {
    expect(
      iapReconcileResponseSchema.parse({
        dispositions: [
          {
            index: 3,
            transactionId: null,
            deliveryAccepted: false,
            safeToFinish: false,
            disposition: 'REJECTED',
            errorCode: 'TRANSACTION_UNVERIFIED',
          },
        ],
      }),
    ).toBeDefined();
  });
});
