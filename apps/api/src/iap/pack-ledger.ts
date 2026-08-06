import { compareAppleFactOrder } from './apple-facts.js';

const grantUnits = 10;
const milliunitFullRefund = 100_000;

export type RefundEventType = 'REFUND' | 'REFUND_REVERSED';

/**
 * One verified refund or reversal fact. Authority rank orders equal-time
 * conflicts: authoritative reconciliation (1) outranks a notification (0).
 */
export interface RefundFact {
  authorityRank: 0 | 1;
  eventType: RefundEventType;
  revocationPercentage: number | null;
  sourceAt: Date;
  sourceId: string;
}

export interface PackGrantRefundState {
  currentRefundTargetUnits: number;
  currentRefundedUnspentUnits: number;
  currentUnrecoveredRefundUnits: number;
  drawnUnits: number;
  greatestRefundSourceAt: Date | null;
  greatestRefundSourceId: string | null;
  greatestRefundSourceType: string | null;
}

export type PackGrantDisposition = 'ACTIVE' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED';

export interface PackGrantConvergence {
  /** Signed ledger delta: negative REFUND_DEBIT, positive REFUND_REINSTATEMENT, 0 none. */
  ledgerDelta: number;
  next: PackGrantRefundState;
  nextDisposition: PackGrantDisposition;
  /** False when the fact is older than or an exact duplicate of the applied one. */
  applied: boolean;
}

const eventTypePrecedence: Record<RefundEventType, number> = {
  REFUND: 0,
  REFUND_REVERSED: 1,
};

export function refundTargetUnits(revocationPercentage: number | null): number {
  const raw = revocationPercentage ?? milliunitFullRefund;
  const clamped = Math.min(Math.max(raw, 0), milliunitFullRefund);
  return Math.floor((grantUnits * clamped) / milliunitFullRefund + 0.5);
}

/**
 * Deterministic (sourceTime, authorityRank, eventTypePrecedence, sourceId)
 * ordering. Returns a positive number when the candidate outranks the applied
 * fact, 0 for an exact tie, negative when the candidate is older.
 */
export function compareRefundFacts(
  candidate: RefundFact,
  applied: {
    authorityRank?: 0 | 1;
    eventType: RefundEventType;
    sourceAt: Date;
    sourceId: string;
  },
): number {
  return compareAppleFactOrder(
    {
      authorityRank: candidate.authorityRank,
      eventPrecedence: eventTypePrecedence[candidate.eventType],
      sourceAt: candidate.sourceAt,
      sourceId: candidate.sourceId,
    },
    {
      authorityRank: applied.authorityRank ?? 0,
      eventPrecedence: eventTypePrecedence[applied.eventType],
      sourceAt: applied.sourceAt,
      sourceId: applied.sourceId,
    },
  );
}

/**
 * Converges one immutable 10-unit grant to a verified refund fact. Debits at
 * most the currently unspent units, records the consumed remainder as
 * unrecovered audit units, and reinstates only units actually removed when a
 * newer reversal wins. Repeated and out-of-order input is harmless.
 */
export function convergePackGrant(
  state: PackGrantRefundState,
  fact: RefundFact,
): PackGrantConvergence {
  const applied =
    state.greatestRefundSourceAt === null ||
    state.greatestRefundSourceId === null ||
    state.greatestRefundSourceType === null
      ? null
      : {
          eventType: state.greatestRefundSourceType as RefundEventType,
          sourceAt: state.greatestRefundSourceAt,
          sourceId: state.greatestRefundSourceId,
        };

  if (applied !== null && compareRefundFacts(fact, applied) <= 0) {
    return {
      applied: false,
      ledgerDelta: 0,
      next: state,
      nextDisposition: dispositionForTarget(state.currentRefundTargetUnits),
    };
  }

  const targetUnits =
    fact.eventType === 'REFUND_REVERSED' ? 0 : refundTargetUnits(fact.revocationPercentage);
  // The consumed portion of the target can only be marked unrecovered, so the
  // debit magnitude is bounded by the units still unspent right now.
  const desiredRefundedUnspent = Math.min(targetUnits, grantUnits - state.drawnUnits);
  const desiredUnrecovered = targetUnits - desiredRefundedUnspent;
  const ledgerDelta = -(desiredRefundedUnspent - state.currentRefundedUnspentUnits);

  const next: PackGrantRefundState = {
    ...state,
    currentRefundTargetUnits: targetUnits,
    currentRefundedUnspentUnits: desiredRefundedUnspent,
    currentUnrecoveredRefundUnits: desiredUnrecovered,
    greatestRefundSourceAt: fact.sourceAt,
    greatestRefundSourceId: fact.sourceId,
    greatestRefundSourceType: fact.eventType,
  };

  return {
    applied: true,
    ledgerDelta,
    next,
    nextDisposition: dispositionForTarget(targetUnits),
  };
}

export function dispositionForTarget(targetUnits: number): PackGrantDisposition {
  if (targetUnits <= 0) {
    return 'ACTIVE';
  }
  return targetUnits >= grantUnits ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED';
}

export function spendableUnits(state: PackGrantRefundState): number {
  return Math.max(
    grantUnits - state.drawnUnits - state.currentRefundedUnspentUnits,
    0,
  );
}
