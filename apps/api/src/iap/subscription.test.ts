import { describe, expect, it } from 'vitest';

import {
  deriveSubscriptionEntitlement,
  isEntitledAt,
  reduceRenewalFacts,
  reduceTransactionRevocation,
  type RenewalState,
  type SubscriptionRevocationFact,
  type TransactionRevocationState,
} from './subscription.js';

const now = new Date('2026-08-06T12:00:00.000Z');
const past = new Date('2026-08-01T00:00:00.000Z');
const future = new Date('2026-09-01T00:00:00.000Z');
const farFuture = new Date('2026-10-01T00:00:00.000Z');

const revocationFact = (
  overrides: Partial<SubscriptionRevocationFact>,
): SubscriptionRevocationFact => ({
  authorityRank: 0,
  kind: 'REFUND',
  revocationAt: now,
  sourceAt: new Date('2026-08-06T10:00:00.000Z'),
  sourceId: 'refund-1',
  ...overrides,
});

const emptyRevocation: TransactionRevocationState = {
  appliedFact: null,
  effectiveRevocationAt: null,
};

describe('deriveSubscriptionEntitlement', () => {
  it('is ACTIVE while the greatest unrevoked expiration is in the future', () => {
    const derivation = deriveSubscriptionEntitlement({
      billingRetry: false,
      effectiveRevocationAt: null,
      graceThrough: null,
      now,
      periods: [
        { expiresAt: past, effectivelyRevoked: false },
        { expiresAt: future, effectivelyRevoked: false },
        { expiresAt: farFuture, effectivelyRevoked: true },
      ],
    });

    expect(derivation.status).toBe('ACTIVE');
    expect(derivation.paidThrough).toEqual(future);
    expect(isEntitledAt(derivation, now)).toBe(true);
  });

  it('uses grace only when no active paid period exists', () => {
    const graceOnly = deriveSubscriptionEntitlement({
      billingRetry: true,
      effectiveRevocationAt: null,
      graceThrough: future,
      now,
      periods: [{ expiresAt: past, effectivelyRevoked: false }],
    });
    expect(graceOnly.status).toBe('GRACE_PERIOD');
    expect(isEntitledAt(graceOnly, now)).toBe(true);

    const activeWins = deriveSubscriptionEntitlement({
      billingRetry: false,
      effectiveRevocationAt: null,
      graceThrough: future,
      now,
      periods: [{ expiresAt: farFuture, effectivelyRevoked: false }],
    });
    expect(activeWins.status).toBe('ACTIVE');
  });

  it('reports billing retry without grace, then revoked, then expired', () => {
    const retry = deriveSubscriptionEntitlement({
      billingRetry: true,
      effectiveRevocationAt: null,
      graceThrough: past,
      now,
      periods: [{ expiresAt: past, effectivelyRevoked: false }],
    });
    expect(retry.status).toBe('BILLING_RETRY');
    expect(isEntitledAt(retry, now)).toBe(false);

    const revoked = deriveSubscriptionEntitlement({
      billingRetry: false,
      effectiveRevocationAt: past,
      graceThrough: null,
      now,
      periods: [{ expiresAt: future, effectivelyRevoked: true }],
    });
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.paidThrough).toBeNull();

    const expired = deriveSubscriptionEntitlement({
      billingRetry: false,
      effectiveRevocationAt: null,
      graceThrough: null,
      now,
      periods: [{ expiresAt: past, effectivelyRevoked: false }],
    });
    expect(expired.status).toBe('EXPIRED');
  });
});

describe('reduceTransactionRevocation', () => {
  it('applies a refund and lets only a newer reversal supersede it', () => {
    const refunded = reduceTransactionRevocation(emptyRevocation, revocationFact({}));
    expect(refunded.applied).toBe(true);
    expect(refunded.next.effectiveRevocationAt).toEqual(now);

    const reversed = reduceTransactionRevocation(
      refunded.next,
      revocationFact({
        kind: 'REFUND_REVERSED',
        revocationAt: null,
        sourceAt: new Date('2026-08-06T11:00:00.000Z'),
        sourceId: 'reversal-1',
      }),
    );
    expect(reversed.applied).toBe(true);
    expect(reversed.next.effectiveRevocationAt).toBeNull();

    const stale = reduceTransactionRevocation(
      reversed.next,
      revocationFact({ sourceAt: new Date('2026-08-06T10:30:00.000Z'), sourceId: 'refund-late' }),
    );
    expect(stale.applied).toBe(false);
    expect(stale.next.effectiveRevocationAt).toBeNull();
  });

  it('lets a reversal outrank an equal-time refund and ignores duplicates', () => {
    const refunded = reduceTransactionRevocation(emptyRevocation, revocationFact({}));
    const equalTimeReversal = reduceTransactionRevocation(
      refunded.next,
      revocationFact({ kind: 'REFUND_REVERSED', revocationAt: null, sourceId: 'reversal-1' }),
    );
    expect(equalTimeReversal.applied).toBe(true);

    const duplicate = reduceTransactionRevocation(refunded.next, revocationFact({}));
    expect(duplicate.applied).toBe(false);
  });
});

describe('reduceRenewalFacts', () => {
  const empty: RenewalState = {
    appliedFact: null,
    autoRenewEnabled: null,
    billingRetry: false,
    graceThrough: null,
  };

  it('applies newer facts and refuses older ones', () => {
    const first = reduceRenewalFacts(empty, {
      authorityRank: 0,
      autoRenewEnabled: false,
      billingRetry: true,
      graceThrough: future,
      sourceAt: new Date('2026-08-06T10:00:00.000Z'),
      sourceId: 'renewal-1',
    });
    expect(first.applied).toBe(true);
    expect(first.next).toMatchObject({
      autoRenewEnabled: false,
      billingRetry: true,
      graceThrough: future,
    });

    const older = reduceRenewalFacts(first.next, {
      authorityRank: 0,
      autoRenewEnabled: true,
      billingRetry: false,
      graceThrough: null,
      sourceAt: new Date('2026-08-06T09:00:00.000Z'),
      sourceId: 'renewal-0',
    });
    expect(older.applied).toBe(false);
    expect(older.next.graceThrough).toEqual(future);
  });

  it('keeps unstated fields from the applied state', () => {
    const first = reduceRenewalFacts(empty, {
      authorityRank: 0,
      autoRenewEnabled: true,
      billingRetry: true,
      graceThrough: null,
      sourceAt: new Date('2026-08-06T10:00:00.000Z'),
      sourceId: 'renewal-1',
    });
    const second = reduceRenewalFacts(first.next, {
      authorityRank: 0,
      autoRenewEnabled: null,
      billingRetry: null,
      graceThrough: future,
      sourceAt: new Date('2026-08-06T11:00:00.000Z'),
      sourceId: 'renewal-2',
    });
    expect(second.next).toMatchObject({
      autoRenewEnabled: true,
      billingRetry: true,
      graceThrough: future,
    });
  });
});
