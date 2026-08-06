import { describe, expect, it } from 'vitest';

import {
  calculateAllowanceAvailability,
  resolveSubscriptionAllowance,
  selectAllowanceSource,
  type SubscriptionEntitlementSnapshot,
} from './allowance.js';

const now = new Date('2026-08-06T10:00:00.000Z');

function entitlement(
  overrides: Partial<SubscriptionEntitlementSnapshot> = {},
): SubscriptionEntitlementSnapshot {
  return {
    graceThrough: null,
    lastAppleEventTime: new Date('2026-08-06T09:00:00.000Z'),
    paidThrough: new Date('2026-09-06T10:00:00.000Z'),
    revokedAt: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('allowance calculation', () => {
  it('grants one free plus ten verified subscription draws before pack credits', () => {
    const availability = calculateAllowanceAvailability({
      entitlements: [entitlement()],
      freeUsed: 0,
      now,
      spendablePackCredits: 7,
      subscriptionUsed: 0,
    });

    expect(availability).toMatchObject({
      availableDraws: 18,
      freeRemaining: 1,
      spendablePackCredits: 7,
      subscriptionRemaining: 10,
      subscription: { entitled: true, status: 'ACTIVE' },
    });
    expect(selectAllowanceSource(availability)).toBe('FREE_DAILY');
    expect(selectAllowanceSource({ ...availability, freeRemaining: 0, availableDraws: 17 })).toBe(
      'SUBSCRIPTION_DAILY',
    );
    expect(
      selectAllowanceSource({
        ...availability,
        freeRemaining: 0,
        subscriptionRemaining: 0,
        availableDraws: 7,
      }),
    ).toBe('PACK_CREDIT');
  });

  it('grants verified grace but not billing retry without grace', () => {
    expect(
      resolveSubscriptionAllowance(
        [
          entitlement({
            status: 'GRACE_PERIOD',
            paidThrough: new Date('2026-08-05T10:00:00.000Z'),
            graceThrough: new Date('2026-08-10T10:00:00.000Z'),
          }),
        ],
        now,
      ),
    ).toMatchObject({ entitled: true, status: 'GRACE_PERIOD' });
    expect(
      resolveSubscriptionAllowance(
        [
          entitlement({
            status: 'BILLING_RETRY',
            paidThrough: new Date('2026-08-05T10:00:00.000Z'),
          }),
        ],
        now,
      ),
    ).toMatchObject({ entitled: false, status: 'BILLING_RETRY' });
  });

  it('does not grant expired or revoked rows even with inconsistent future timestamps', () => {
    expect(
      resolveSubscriptionAllowance(
        [entitlement({ status: 'EXPIRED' }), entitlement({ revokedAt: now })],
        now,
      ).entitled,
    ).toBe(false);
  });

  it('expires a paid-through boundary at the exact server instant', () => {
    expect(resolveSubscriptionAllowance([entitlement({ paidThrough: now })], now)).toMatchObject({
      entitled: false,
      status: 'ACTIVE',
    });
  });

  it('clamps used counters and externally supplied balances to nonnegative availability', () => {
    expect(
      calculateAllowanceAvailability({
        entitlements: [],
        freeUsed: 8,
        now,
        spendablePackCredits: -9,
        subscriptionUsed: -3,
      }),
    ).toMatchObject({
      availableDraws: 0,
      freeRemaining: 0,
      spendablePackCredits: 0,
      subscriptionRemaining: 0,
    });
  });
});
