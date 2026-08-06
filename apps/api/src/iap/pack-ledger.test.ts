import { describe, expect, it } from 'vitest';

import {
  compareRefundFacts,
  convergePackGrant,
  refundTargetUnits,
  spendableUnits,
  type PackGrantRefundState,
  type RefundFact,
} from './pack-ledger.js';

const freshGrant: PackGrantRefundState = {
  currentRefundTargetUnits: 0,
  currentRefundedUnspentUnits: 0,
  currentUnrecoveredRefundUnits: 0,
  drawnUnits: 0,
  greatestRefundSourceAt: null,
  greatestRefundSourceId: null,
  greatestRefundSourceType: null,
};

const fact = (overrides: Partial<RefundFact>): RefundFact => ({
  authorityRank: 0,
  eventType: 'REFUND',
  revocationPercentage: null,
  sourceAt: new Date('2026-08-06T10:00:00.000Z'),
  sourceId: 'refund-1',
  ...overrides,
});

describe('refundTargetUnits', () => {
  it('rounds half up from milliunits and clamps the documented range', () => {
    expect(refundTargetUnits(null)).toBe(10);
    expect(refundTargetUnits(100_000)).toBe(10);
    expect(refundTargetUnits(50_000)).toBe(5);
    expect(refundTargetUnits(45_000)).toBe(5);
    expect(refundTargetUnits(44_999)).toBe(4);
    expect(refundTargetUnits(1)).toBe(0);
    expect(refundTargetUnits(5_000)).toBe(1);
    expect(refundTargetUnits(-5)).toBe(0);
    expect(refundTargetUnits(200_000)).toBe(10);
  });
});

describe('compareRefundFacts', () => {
  const applied = {
    eventType: 'REFUND' as const,
    sourceAt: new Date('2026-08-06T10:00:00.000Z'),
    sourceId: 'refund-1',
  };

  it('prefers newer source time regardless of rank', () => {
    expect(
      compareRefundFacts(fact({ sourceAt: new Date('2026-08-06T11:00:00.000Z') }), applied),
    ).toBeGreaterThan(0);
    expect(
      compareRefundFacts(
        fact({ sourceAt: new Date('2026-08-06T09:00:00.000Z'), authorityRank: 1 }),
        applied,
      ),
    ).toBeLessThan(0);
  });

  it('breaks equal times by authority, then reversal precedence, then stable ID', () => {
    expect(compareRefundFacts(fact({ authorityRank: 1 }), applied)).toBeGreaterThan(0);
    expect(compareRefundFacts(fact({ eventType: 'REFUND_REVERSED' }), applied)).toBeGreaterThan(0);
    expect(compareRefundFacts(fact({ sourceId: 'refund-2' }), applied)).toBeGreaterThan(0);
    expect(compareRefundFacts(fact({}), applied)).toBe(0);
  });
});

describe('convergePackGrant', () => {
  it('debits a full refund before any draw and leaves zero spendable units', () => {
    const result = convergePackGrant(freshGrant, fact({}));

    expect(result.applied).toBe(true);
    expect(result.ledgerDelta).toBe(-10);
    expect(result.nextDisposition).toBe('FULLY_REFUNDED');
    expect(result.next.currentRefundedUnspentUnits).toBe(10);
    expect(result.next.currentUnrecoveredRefundUnits).toBe(0);
    expect(spendableUnits(result.next)).toBe(0);
  });

  it('marks consumed refund units unrecovered instead of going negative', () => {
    const partiallyDrawn = { ...freshGrant, drawnUnits: 4 };
    const result = convergePackGrant(partiallyDrawn, fact({}));

    expect(result.ledgerDelta).toBe(-6);
    expect(result.next.currentRefundedUnspentUnits).toBe(6);
    expect(result.next.currentUnrecoveredRefundUnits).toBe(4);
    expect(spendableUnits(result.next)).toBe(0);
  });

  it('keeps the unrefunded remainder spendable on a partial refund', () => {
    const result = convergePackGrant(freshGrant, fact({ revocationPercentage: 30_000 }));

    expect(result.ledgerDelta).toBe(-3);
    expect(result.nextDisposition).toBe('PARTIALLY_REFUNDED');
    expect(spendableUnits(result.next)).toBe(7);
  });

  it('reinstates exactly the removed units on a newer reversal', () => {
    const partiallyDrawn = { ...freshGrant, drawnUnits: 4 };
    const refunded = convergePackGrant(partiallyDrawn, fact({}));
    const reversed = convergePackGrant(
      refunded.next,
      fact({
        eventType: 'REFUND_REVERSED',
        sourceAt: new Date('2026-08-06T12:00:00.000Z'),
        sourceId: 'reversal-1',
      }),
    );

    expect(reversed.ledgerDelta).toBe(6);
    expect(reversed.nextDisposition).toBe('ACTIVE');
    expect(reversed.next.currentRefundTargetUnits).toBe(0);
    expect(reversed.next.currentUnrecoveredRefundUnits).toBe(0);
    expect(spendableUnits(reversed.next)).toBe(6);
  });

  it('ignores a stale refund arriving after a newer reversal', () => {
    const refunded = convergePackGrant(freshGrant, fact({}));
    const reversed = convergePackGrant(
      refunded.next,
      fact({
        eventType: 'REFUND_REVERSED',
        sourceAt: new Date('2026-08-06T12:00:00.000Z'),
        sourceId: 'reversal-1',
      }),
    );
    const stale = convergePackGrant(
      reversed.next,
      fact({ sourceAt: new Date('2026-08-06T11:00:00.000Z'), sourceId: 'refund-stale' }),
    );

    expect(stale.applied).toBe(false);
    expect(stale.ledgerDelta).toBe(0);
    expect(spendableUnits(stale.next)).toBe(10);
  });

  it('treats an exact duplicate fact as a no-op', () => {
    const refunded = convergePackGrant(freshGrant, fact({}));
    const duplicate = convergePackGrant(refunded.next, fact({}));

    expect(duplicate.applied).toBe(false);
    expect(duplicate.ledgerDelta).toBe(0);
  });

  it('lets authoritative reconciliation outrank an equal-time notification', () => {
    const refunded = convergePackGrant(freshGrant, fact({ revocationPercentage: 100_000 }));
    const corrected = convergePackGrant(
      refunded.next,
      fact({ authorityRank: 1, revocationPercentage: 50_000, sourceId: 'reconcile-1' }),
    );

    expect(corrected.applied).toBe(true);
    expect(corrected.ledgerDelta).toBe(5);
    expect(spendableUnits(corrected.next)).toBe(5);
  });

  it('converges a refund recorded before delivery when the grant is created', () => {
    // The refund notification arrived before the client delivered the
    // purchase: the grant starts fresh and immediately converges.
    const result = convergePackGrant(freshGrant, fact({}));
    expect(spendableUnits(result.next)).toBe(0);

    const laterReversal = convergePackGrant(
      result.next,
      fact({
        eventType: 'REFUND_REVERSED',
        sourceAt: new Date('2026-08-07T00:00:00.000Z'),
        sourceId: 'reversal-2',
      }),
    );
    expect(laterReversal.ledgerDelta).toBe(10);
    expect(spendableUnits(laterReversal.next)).toBe(10);
  });
});
