import { type AllowanceSource, type SubscriptionAllowance } from '@fortuneness/api-contracts';

export interface SubscriptionEntitlementSnapshot {
  graceThrough: Date | null;
  lastAppleEventTime: Date;
  paidThrough: Date | null;
  revokedAt: Date | null;
  status: 'ACTIVE' | 'BILLING_RETRY' | 'EXPIRED' | 'GRACE_PERIOD' | 'REVOKED';
}

export interface AllowanceAvailability {
  availableDraws: number;
  freeRemaining: number;
  spendablePackCredits: number;
  subscription: SubscriptionAllowance;
  subscriptionRemaining: number;
}

function isFuture(boundary: Date | null, now: Date): boundary is Date {
  return boundary !== null && boundary > now;
}

export function resolveSubscriptionAllowance(
  entitlements: readonly SubscriptionEntitlementSnapshot[],
  now: Date,
): SubscriptionAllowance {
  const ordered = [...entitlements].sort(
    (left, right) => right.lastAppleEventTime.getTime() - left.lastAppleEventTime.getTime(),
  );
  const active = ordered
    .filter(
      (entitlement) =>
        entitlement.revokedAt === null &&
        entitlement.status === 'ACTIVE' &&
        isFuture(entitlement.paidThrough, now),
    )
    .sort(
      (left, right) => (right.paidThrough?.getTime() ?? 0) - (left.paidThrough?.getTime() ?? 0),
    )[0];
  if (active !== undefined) {
    return {
      status: 'ACTIVE',
      entitled: true,
      paidThrough: active.paidThrough?.toISOString() ?? null,
      graceThrough: active.graceThrough?.toISOString() ?? null,
    };
  }
  const grace = ordered
    .filter(
      (entitlement) =>
        entitlement.revokedAt === null &&
        entitlement.status === 'GRACE_PERIOD' &&
        isFuture(entitlement.graceThrough, now),
    )
    .sort(
      (left, right) => (right.graceThrough?.getTime() ?? 0) - (left.graceThrough?.getTime() ?? 0),
    )[0];
  if (grace !== undefined) {
    return {
      status: 'GRACE_PERIOD',
      entitled: true,
      paidThrough: grace.paidThrough?.toISOString() ?? null,
      graceThrough: grace.graceThrough?.toISOString() ?? null,
    };
  }
  const latest = ordered[0];
  return latest === undefined
    ? {
        status: 'NONE',
        entitled: false,
        paidThrough: null,
        graceThrough: null,
      }
    : {
        status: latest.revokedAt === null ? latest.status : 'REVOKED',
        entitled: false,
        paidThrough: latest.paidThrough?.toISOString() ?? null,
        graceThrough: latest.graceThrough?.toISOString() ?? null,
      };
}

export function calculateAllowanceAvailability(options: {
  entitlements: readonly SubscriptionEntitlementSnapshot[];
  freeUsed: number;
  now: Date;
  spendablePackCredits: number;
  subscriptionUsed: number;
}): AllowanceAvailability {
  const subscription = resolveSubscriptionAllowance(options.entitlements, options.now);
  const freeRemaining = Math.max(1 - Math.max(options.freeUsed, 0), 0);
  const subscriptionRemaining = subscription.entitled
    ? Math.max(10 - Math.max(options.subscriptionUsed, 0), 0)
    : 0;
  const spendablePackCredits = Math.max(options.spendablePackCredits, 0);
  return {
    freeRemaining,
    subscriptionRemaining,
    spendablePackCredits,
    availableDraws: freeRemaining + subscriptionRemaining + spendablePackCredits,
    subscription,
  };
}

export function selectAllowanceSource(
  availability: AllowanceAvailability,
): AllowanceSource | undefined {
  if (availability.freeRemaining > 0) {
    return 'FREE_DAILY';
  }
  if (availability.subscriptionRemaining > 0) {
    return 'SUBSCRIPTION_DAILY';
  }
  if (availability.spendablePackCredits > 0) {
    return 'PACK_CREDIT';
  }
  return undefined;
}
