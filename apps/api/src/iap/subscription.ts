import { compareAppleFactOrder, type AppleFactOrder } from './apple-facts.js';

export type SubscriptionEventKind = 'REVOKE' | 'REFUND' | 'REFUND_REVERSED';

const revocationPrecedence: Record<SubscriptionEventKind, number> = {
  REFUND: 0,
  REVOKE: 0,
  REFUND_REVERSED: 1,
};

export interface SubscriptionRevocationFact {
  authorityRank: 0 | 1;
  kind: SubscriptionEventKind;
  /** Apple revocation timestamp; null for a reversal that clears it. */
  revocationAt: Date | null;
  sourceAt: Date;
  sourceId: string;
}

export interface TransactionRevocationState {
  appliedFact: AppleFactOrder | null;
  effectiveRevocationAt: Date | null;
}

/**
 * Serializes revocation truth for one subscription transaction. Revocation
 * and refund facts stay effective unless a strictly newer verified reversal
 * or newer authoritative fact supersedes them; older facts are audit-only.
 */
export function reduceTransactionRevocation(
  state: TransactionRevocationState,
  fact: SubscriptionRevocationFact,
): { applied: boolean; next: TransactionRevocationState } {
  const candidate: AppleFactOrder = {
    authorityRank: fact.authorityRank,
    eventPrecedence: revocationPrecedence[fact.kind],
    sourceAt: fact.sourceAt,
    sourceId: fact.sourceId,
  };
  if (state.appliedFact !== null && compareAppleFactOrder(candidate, state.appliedFact) <= 0) {
    return { applied: false, next: state };
  }
  return {
    applied: true,
    next: {
      appliedFact: candidate,
      effectiveRevocationAt: fact.kind === 'REFUND_REVERSED' ? null : fact.revocationAt,
    },
  };
}

export interface SubscriptionPeriod {
  expiresAt: Date | null;
  effectivelyRevoked: boolean;
}

export type DerivedSubscriptionStatus =
  | 'ACTIVE'
  | 'GRACE_PERIOD'
  | 'BILLING_RETRY'
  | 'EXPIRED'
  | 'REVOKED';

export interface SubscriptionEntitlementDerivation {
  graceThrough: Date | null;
  paidThrough: Date | null;
  revokedAt: Date | null;
  status: DerivedSubscriptionStatus;
}

export interface SubscriptionDerivationInput {
  billingRetry: boolean;
  effectiveRevocationAt: Date | null;
  graceThrough: Date | null;
  now: Date;
  periods: readonly SubscriptionPeriod[];
}

/**
 * Derives the canonical aggregate entitlement with server time. paidThrough
 * is the greatest eligible unrevoked expiration; a stale status enum can
 * never grant access because every consumer re-derives from these
 * timestamps.
 */
export function deriveSubscriptionEntitlement(
  input: SubscriptionDerivationInput,
): SubscriptionEntitlementDerivation {
  let paidThrough: Date | null = null;
  for (const period of input.periods) {
    if (period.effectivelyRevoked || period.expiresAt === null) {
      continue;
    }
    if (paidThrough === null || period.expiresAt.getTime() > paidThrough.getTime()) {
      paidThrough = period.expiresAt;
    }
  }

  const nowMs = input.now.getTime();
  const hasActivePaidPeriod = paidThrough !== null && paidThrough.getTime() > nowMs;
  const hasActiveGrace =
    !hasActivePaidPeriod && input.graceThrough !== null && input.graceThrough.getTime() > nowMs;

  let status: DerivedSubscriptionStatus;
  if (hasActivePaidPeriod) {
    status = 'ACTIVE';
  } else if (hasActiveGrace) {
    status = 'GRACE_PERIOD';
  } else if (input.billingRetry) {
    status = 'BILLING_RETRY';
  } else if (input.effectiveRevocationAt !== null) {
    status = 'REVOKED';
  } else {
    status = 'EXPIRED';
  }

  return {
    graceThrough: input.graceThrough,
    paidThrough,
    revokedAt: input.effectiveRevocationAt,
    status,
  };
}

export interface RenewalFact {
  authorityRank: 0 | 1;
  autoRenewEnabled: boolean | null;
  billingRetry: boolean | null;
  graceThrough: Date | null;
  sourceAt: Date;
  sourceId: string;
}

export interface RenewalState {
  appliedFact: AppleFactOrder | null;
  autoRenewEnabled: boolean | null;
  billingRetry: boolean;
  graceThrough: Date | null;
}

/**
 * Applies renewal-side facts (grace expiration, billing retry, auto-renew
 * preference) only when the fact outranks the applied one; an older event may
 * fill history elsewhere but cannot erase newer verified state here.
 */
export function reduceRenewalFacts(
  state: RenewalState,
  fact: RenewalFact,
): { applied: boolean; next: RenewalState } {
  const candidate: AppleFactOrder = {
    authorityRank: fact.authorityRank,
    eventPrecedence: 0,
    sourceAt: fact.sourceAt,
    sourceId: fact.sourceId,
  };
  if (state.appliedFact !== null && compareAppleFactOrder(candidate, state.appliedFact) <= 0) {
    return { applied: false, next: state };
  }
  return {
    applied: true,
    next: {
      appliedFact: candidate,
      autoRenewEnabled: fact.autoRenewEnabled ?? state.autoRenewEnabled,
      billingRetry: fact.billingRetry ?? state.billingRetry,
      graceThrough: fact.graceThrough,
    },
  };
}

/**
 * Subscriber allowance eligibility for a draw: entitled while a verified paid
 * period or verified future grace expiration covers the server clock.
 * Auto-renew preference never grants or removes access.
 */
export function isEntitledAt(
  derivation: Pick<SubscriptionEntitlementDerivation, 'graceThrough' | 'paidThrough'>,
  now: Date,
): boolean {
  const nowMs = now.getTime();
  return (
    (derivation.paidThrough !== null && derivation.paidThrough.getTime() > nowMs) ||
    (derivation.graceThrough !== null && derivation.graceThrough.getTime() > nowMs)
  );
}
