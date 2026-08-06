import { DatabaseError } from '../db/errors.js';
import {
  lockFinancialSubjectForUpdate,
  runReadCommittedTransaction,
  type TransactionRetryOptions,
} from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import {
  convergePackGrant,
  type PackGrantRefundState,
  type RefundFact,
  type RefundEventType,
} from './pack-ledger.js';
import {
  deriveSubscriptionEntitlement,
  reduceRenewalFacts,
  reduceTransactionRevocation,
  type RenewalFact,
  type SubscriptionEventKind,
} from './subscription.js';
import { type VerifiedAppleTransaction } from './verification.js';

export type IapApplicationErrorCode =
  | 'TRANSACTION_OWNER_UNKNOWN'
  | 'RETRYABLE_CONFLICT'
  | 'INTERNAL_CONFLICT';

export class IapApplicationError extends Error {
  readonly code: IapApplicationErrorCode;

  constructor(code: IapApplicationErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'IapApplicationError';
    this.code = code;
  }
}

/**
 * The stable identity and ordering context of one application attempt.
 * Authority rank 1 marks authoritative App Store Server API reconciliation;
 * rank 0 marks client deliveries and server notifications.
 */
export interface TransactionApplicationContext {
  authorityRank: 0 | 1;
  /** Explicit corrective event conveyed by the surrounding notification. */
  refundEventType?: RefundEventType | null;
  /** Renewal-side facts decoded from signed renewal info, when present. */
  renewalFact?: {
    autoRenewEnabled: boolean | null;
    billingRetry: boolean | null;
    graceThrough: Date | null;
  } | null;
  sourceAt: Date;
  sourceId: string;
}

export interface TransactionApplicationOutcome {
  appliedNow: boolean;
  ownerClosed: boolean;
  ownerFinancialSubjectId: string;
  transactionId: string;
}

interface ResolvedOwnership {
  financialSubjectId: string;
  tokenBindingId: string | null;
}

export interface TokenOwnerResolver {
  (
    transaction: Prisma.TransactionClient,
    rawToken: string,
  ): Promise<{ bindingId: string; financialSubjectId: string } | null>;
}

interface IapApplicationServiceOptions {
  client: PrismaClient;
  now?: () => Date;
  resolveTokenOwner: TokenOwnerResolver;
  retry?: TransactionRetryOptions;
}

const advisoryLockNamespace = 0x1a9_c0de;

function businessKey(verified: VerifiedAppleTransaction): string {
  return verified.productType === 'AUTO_RENEWABLE_SUBSCRIPTION'
    ? `${verified.environment}:original:${verified.originalTransactionId}`
    : `${verified.environment}:transaction:${verified.transactionId}`;
}

/**
 * Applies one verified StoreKit transaction exactly once, no matter which
 * path delivered it: client delivery, ONE_TIME_CHARGE or another
 * notification, or scheduled reconciliation. See spec section 7.3.
 */
export class IapApplicationService {
  private readonly client: PrismaClient;
  private readonly now: () => Date;
  private readonly resolveTokenOwner: TokenOwnerResolver;
  private readonly retry: TransactionRetryOptions;

  constructor(options: IapApplicationServiceOptions) {
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
    this.resolveTokenOwner = options.resolveTokenOwner;
    this.retry = options.retry ?? {};
  }

  async apply(
    verified: VerifiedAppleTransaction,
    context: TransactionApplicationContext,
  ): Promise<TransactionApplicationOutcome> {
    try {
      return await runReadCommittedTransaction(
        this.client,
        async (transaction) => {
          await this.acquireBusinessKeyLock(transaction, verified);
          const ownership = await this.resolveOwnership(transaction, verified);
          const owner = await lockFinancialSubjectForUpdate(
            transaction,
            ownership.financialSubjectId,
          );
          const now = this.now();

          if (owner.benefitsDisabledAt !== null) {
            const previouslyApplied = await this.recordClosedOwnerTransaction(
              transaction,
              verified,
              ownership,
              now,
            );
            return {
              appliedNow: false,
              ownerClosed: !previouslyApplied,
              ownerFinancialSubjectId: owner.id,
              transactionId: verified.transactionId,
            };
          }

          const appliedNow =
            verified.productType === 'CONSUMABLE'
              ? await this.applyConsumable(transaction, verified, context, ownership, now)
              : await this.applySubscription(transaction, verified, context, ownership, now);

          return {
            appliedNow,
            ownerClosed: false,
            ownerFinancialSubjectId: owner.id,
            transactionId: verified.transactionId,
          };
        },
        this.retry,
      );
    } catch (error) {
      if (error instanceof IapApplicationError) {
        throw error;
      }
      if (error instanceof DatabaseError && error.retryable) {
        throw new IapApplicationError(
          'RETRYABLE_CONFLICT',
          'The commerce locks could not be acquired; retry without finishing.',
          error,
        );
      }
      throw error;
    }
  }

  private async acquireBusinessKeyLock(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
  ): Promise<void> {
    const key = businessKey(verified);
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(${advisoryLockNamespace}::int, hashtext(${key}))::text AS locked
    `;
  }

  private async resolveOwnership(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
  ): Promise<ResolvedOwnership> {
    const existing = await transaction.iapTransaction.findUnique({
      where: {
        environment_transactionId: {
          environment: verified.environment,
          transactionId: verified.transactionId,
        },
      },
      select: { financialSubjectId: true, tokenBindingId: true },
    });

    let businessKeyOwner: ResolvedOwnership | null =
      existing === null
        ? null
        : {
            financialSubjectId: existing.financialSubjectId,
            tokenBindingId: existing.tokenBindingId,
          };

    if (businessKeyOwner === null && verified.productType === 'AUTO_RENEWABLE_SUBSCRIPTION') {
      const sibling =
        (await transaction.subscriptionEntitlement.findUnique({
          where: {
            environment_originalTransactionId: {
              environment: verified.environment,
              originalTransactionId: verified.originalTransactionId,
            },
          },
          select: { financialSubjectId: true },
        })) ??
        (await transaction.iapTransaction.findFirst({
          where: {
            environment: verified.environment,
            originalTransactionId: verified.originalTransactionId,
          },
          orderBy: [{ purchaseAt: 'asc' }, { id: 'asc' }],
          select: { financialSubjectId: true },
        }));
      if (sibling !== null) {
        businessKeyOwner = {
          financialSubjectId: sibling.financialSubjectId,
          tokenBindingId: null,
        };
      }
    }

    const tokenOwner =
      verified.appAccountToken === null
        ? null
        : await this.resolveTokenOwner(transaction, verified.appAccountToken);

    if (
      businessKeyOwner !== null &&
      tokenOwner !== null &&
      tokenOwner.financialSubjectId !== businessKeyOwner.financialSubjectId
    ) {
      // A nonnil token must agree with recorded business-key ownership.
      await this.recordQuarantineAudit(transaction, verified, 'iap.transaction.token_conflict');
      throw new IapApplicationError(
        'TRANSACTION_OWNER_UNKNOWN',
        'The purchase token conflicts with the recorded transaction owner.',
      );
    }

    if (businessKeyOwner !== null) {
      return businessKeyOwner;
    }
    if (tokenOwner !== null) {
      return {
        financialSubjectId: tokenOwner.financialSubjectId,
        tokenBindingId: tokenOwner.bindingId,
      };
    }

    await this.recordQuarantineAudit(transaction, verified, 'iap.transaction.quarantined');
    throw new IapApplicationError(
      'TRANSACTION_OWNER_UNKNOWN',
      'Neither a business key nor a known purchase token identifies an owner.',
    );
  }

  private async recordQuarantineAudit(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
    action: string,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        actorType: 'APPLE',
        action,
        targetType: 'IapTransaction',
        targetId: `${verified.environment}:${verified.transactionId}`,
        metadata: {
          environment: verified.environment,
          jwsHash: verified.jwsHash,
          productId: verified.productId,
          productType: verified.productType,
        },
      },
    });
  }

  private async upsertTransactionRow(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
    ownership: ResolvedOwnership,
  ): Promise<{ created: boolean; id: string }> {
    const existing = await transaction.iapTransaction.findUnique({
      where: {
        environment_transactionId: {
          environment: verified.environment,
          transactionId: verified.transactionId,
        },
      },
    });

    if (existing !== null) {
      const immutableMatches =
        existing.originalTransactionId === verified.originalTransactionId &&
        existing.productId === verified.productId &&
        existing.productType === verified.productType &&
        existing.financialSubjectId === ownership.financialSubjectId &&
        existing.purchaseAt.getTime() === verified.purchaseAt.getTime();
      if (!immutableMatches) {
        throw new IapApplicationError(
          'INTERNAL_CONFLICT',
          'A verified transaction disagrees with its recorded immutable fields.',
        );
      }
      return { created: false, id: existing.id };
    }

    const created = await transaction.iapTransaction.create({
      data: {
        environment: verified.environment,
        transactionId: verified.transactionId,
        originalTransactionId: verified.originalTransactionId,
        productId: verified.productId,
        productType: verified.productType,
        billingPlanType: verified.billingPlanType,
        financialSubjectId: ownership.financialSubjectId,
        tokenBindingId: ownership.tokenBindingId,
        purchaseAt: verified.purchaseAt,
        expiresAt: verified.expiresAt,
        revocationAt: verified.revocationAt,
        revocationReason: verified.revocationReason,
        revocationPercentage: verified.revocationPercentage,
        applicationStatus: 'RECEIVED',
        disposition: 'PENDING',
        normalizedPayload: verified.normalizedPayload as Prisma.InputJsonValue,
        jwsHash: verified.jwsHash,
      },
    });
    return { created: true, id: created.id };
  }

  private refundFactFrom(
    verified: VerifiedAppleTransaction,
    context: TransactionApplicationContext,
  ): RefundFact | null {
    if (context.refundEventType === 'REFUND_REVERSED') {
      return {
        authorityRank: context.authorityRank,
        eventType: 'REFUND_REVERSED',
        revocationPercentage: null,
        sourceAt: context.sourceAt,
        sourceId: context.sourceId,
      };
    }
    if (context.refundEventType === 'REFUND' || verified.revocationAt !== null) {
      return {
        authorityRank: context.authorityRank,
        eventType: 'REFUND',
        revocationPercentage: verified.revocationPercentage,
        sourceAt: verified.revocationAt ?? context.sourceAt,
        sourceId: context.sourceId,
      };
    }
    return null;
  }

  private async ledgerBalance(
    transaction: Prisma.TransactionClient,
    financialSubjectId: string,
  ): Promise<number> {
    const aggregate = await transaction.creditLedgerEntry.aggregate({
      where: { financialSubjectId },
      _sum: { delta: true },
    });
    return aggregate._sum.delta ?? 0;
  }

  private async applyConsumable(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
    context: TransactionApplicationContext,
    ownership: ResolvedOwnership,
    now: Date,
  ): Promise<boolean> {
    const row = await this.upsertTransactionRow(transaction, verified, ownership);
    let appliedNow = false;

    let grant = await transaction.packCreditGrant.findUnique({
      where: { purchaseTransactionId: row.id },
    });

    if (grant === null) {
      const balance = await this.ledgerBalance(transaction, ownership.financialSubjectId);
      grant = await transaction.packCreditGrant.create({
        data: {
          financialSubjectId: ownership.financialSubjectId,
          purchaseTransactionId: row.id,
          originalUnits: 10,
        },
      });
      await transaction.creditLedgerEntry.create({
        data: {
          financialSubjectId: ownership.financialSubjectId,
          delta: 10,
          balanceAfter: balance + 10,
          reason: 'PACK_PURCHASE',
          grantId: grant.id,
          purchaseTransactionId: row.id,
          effectKey: `purchase:${verified.environment}:${verified.transactionId}`,
        },
      });
      appliedNow = true;
    }

    const fact = this.refundFactFrom(verified, context);
    if (fact !== null) {
      const state: PackGrantRefundState = {
        currentRefundTargetUnits: grant.currentRefundTargetUnits,
        currentRefundedUnspentUnits: grant.currentRefundedUnspentUnits,
        currentUnrecoveredRefundUnits: grant.currentUnrecoveredRefundUnits,
        drawnUnits: grant.drawnUnits,
        greatestRefundSourceAt: grant.greatestRefundSourceAt,
        greatestRefundSourceId: grant.greatestRefundSourceId,
        greatestRefundSourceType: grant.greatestRefundSourceType,
      };
      const convergence = convergePackGrant(state, fact);

      if (convergence.applied) {
        await transaction.packCreditGrant.update({
          where: { id: grant.id },
          data: {
            currentRefundTargetUnits: convergence.next.currentRefundTargetUnits,
            currentRefundedUnspentUnits: convergence.next.currentRefundedUnspentUnits,
            currentUnrecoveredRefundUnits: convergence.next.currentUnrecoveredRefundUnits,
            greatestRefundSourceAt: fact.sourceAt,
            greatestRefundSourceId: fact.sourceId,
            greatestRefundSourceType: fact.eventType,
            greatestRefundSourceRank: fact.authorityRank,
            disposition: convergence.nextDisposition,
          },
        });
        if (convergence.ledgerDelta !== 0) {
          const balance = await this.ledgerBalance(transaction, ownership.financialSubjectId);
          await transaction.creditLedgerEntry.create({
            data: {
              financialSubjectId: ownership.financialSubjectId,
              delta: convergence.ledgerDelta,
              balanceAfter: balance + convergence.ledgerDelta,
              reason: convergence.ledgerDelta < 0 ? 'REFUND_DEBIT' : 'REFUND_REINSTATEMENT',
              grantId: grant.id,
              purchaseTransactionId: row.id,
              refundSourceId: fact.sourceId,
              effectKey: `refund:${grant.id}:${fact.sourceId}`,
            },
          });
        }
        appliedNow = true;
      }
    }

    await this.markTransactionApplied(transaction, row.id, now);
    return appliedNow;
  }

  private async applySubscription(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
    context: TransactionApplicationContext,
    ownership: ResolvedOwnership,
    now: Date,
  ): Promise<boolean> {
    const row = await this.upsertTransactionRow(transaction, verified, ownership);
    let appliedNow = row.created;

    const stored = await transaction.iapTransaction.findUniqueOrThrow({
      where: { id: row.id },
    });

    // Reduce this transaction's effective revocation from the delivered fact.
    const revocationKind: SubscriptionEventKind | null =
      context.refundEventType === 'REFUND_REVERSED'
        ? 'REFUND_REVERSED'
        : context.refundEventType === 'REFUND'
          ? 'REFUND'
          : verified.revocationAt !== null
            ? 'REVOKE'
            : null;

    if (revocationKind !== null) {
      const reduction = reduceTransactionRevocation(
        {
          appliedFact:
            stored.revocationFactAt === null ||
            stored.revocationFactType === null ||
            stored.revocationFactId === null
              ? null
              : {
                  authorityRank: stored.revocationFactRank === 1 ? 1 : 0,
                  eventPrecedence: stored.revocationFactType === 'REFUND_REVERSED' ? 1 : 0,
                  sourceAt: stored.revocationFactAt,
                  sourceId: stored.revocationFactId,
                },
          effectiveRevocationAt: stored.revocationAt,
        },
        {
          authorityRank: context.authorityRank,
          kind: revocationKind,
          revocationAt: verified.revocationAt ?? context.sourceAt,
          sourceAt: verified.revocationAt ?? context.sourceAt,
          sourceId: context.sourceId,
        },
      );
      if (reduction.applied) {
        const cleared = reduction.next.effectiveRevocationAt === null;
        await transaction.iapTransaction.update({
          where: { id: row.id },
          data: {
            revocationAt: reduction.next.effectiveRevocationAt,
            revocationReason: cleared ? null : (verified.revocationReason ?? '0'),
            revocationPercentage: cleared ? null : verified.revocationPercentage,
            revocationFactAt: reduction.next.appliedFact?.sourceAt ?? null,
            revocationFactRank: reduction.next.appliedFact?.authorityRank ?? 0,
            revocationFactType: revocationKind,
            revocationFactId: reduction.next.appliedFact?.sourceId ?? null,
          },
        });
        appliedNow = true;
      }
    } else if (!row.created && stored.expiresAt?.getTime() !== verified.expiresAt?.getTime()) {
      // A refetched renewal can extend the raw expiration for this same
      // transaction identity; keep the greatest verified value.
      if (
        verified.expiresAt !== null &&
        (stored.expiresAt === null || verified.expiresAt.getTime() > stored.expiresAt.getTime())
      ) {
        await transaction.iapTransaction.update({
          where: { id: row.id },
          data: { expiresAt: verified.expiresAt },
        });
        appliedNow = true;
      }
    }

    // Renewal-side facts (grace, billing retry, auto-renew preference).
    const entitlement = await transaction.subscriptionEntitlement.findUnique({
      where: {
        environment_originalTransactionId: {
          environment: verified.environment,
          originalTransactionId: verified.originalTransactionId,
        },
      },
    });

    let renewalState = {
      appliedFact:
        entitlement === null ||
        entitlement.renewalAppliedAt === null ||
        entitlement.renewalAppliedId === null
          ? null
          : {
              authorityRank: (entitlement.renewalAppliedRank === 1 ? 1 : 0) as 0 | 1,
              eventPrecedence: 0,
              sourceAt: entitlement.renewalAppliedAt,
              sourceId: entitlement.renewalAppliedId,
            },
      autoRenewEnabled: entitlement?.autoRenewEnabled ?? null,
      billingRetry: entitlement?.billingRetry ?? false,
      graceThrough: entitlement?.graceThrough ?? null,
    };

    if (context.renewalFact !== undefined && context.renewalFact !== null) {
      const renewalReduction = reduceRenewalFacts(renewalState, {
        authorityRank: context.authorityRank,
        autoRenewEnabled: context.renewalFact.autoRenewEnabled,
        billingRetry: context.renewalFact.billingRetry,
        graceThrough: context.renewalFact.graceThrough,
        sourceAt: context.sourceAt,
        sourceId: context.sourceId,
      } satisfies RenewalFact);
      if (renewalReduction.applied) {
        renewalState = renewalReduction.next;
        appliedNow = true;
      }
    }

    // Recompute the canonical aggregate entitlement from all verified facts.
    const periods = await transaction.iapTransaction.findMany({
      where: {
        environment: verified.environment,
        originalTransactionId: verified.originalTransactionId,
        productType: 'AUTO_RENEWABLE_SUBSCRIPTION',
      },
      select: { expiresAt: true, revocationAt: true },
    });
    const effectiveRevocationAt = periods.reduce<Date | null>(
      (latest, period) =>
        period.revocationAt !== null &&
        (latest === null || period.revocationAt.getTime() > latest.getTime())
          ? period.revocationAt
          : latest,
      null,
    );
    const derivation = deriveSubscriptionEntitlement({
      billingRetry: renewalState.billingRetry,
      effectiveRevocationAt,
      graceThrough: renewalState.graceThrough,
      now,
      periods: periods.map((period) => ({
        expiresAt: period.expiresAt,
        effectivelyRevoked: period.revocationAt !== null,
      })),
    });

    const greatestEventTime =
      entitlement === null || entitlement.lastAppleEventTime.getTime() < context.sourceAt.getTime()
        ? context.sourceAt
        : entitlement.lastAppleEventTime;
    const greatestSourceId =
      entitlement === null || entitlement.lastAppleEventTime.getTime() < context.sourceAt.getTime()
        ? context.sourceId
        : entitlement.lastAppleSourceId;

    await transaction.subscriptionEntitlement.upsert({
      where: {
        environment_originalTransactionId: {
          environment: verified.environment,
          originalTransactionId: verified.originalTransactionId,
        },
      },
      create: {
        environment: verified.environment,
        originalTransactionId: verified.originalTransactionId,
        financialSubjectId: ownership.financialSubjectId,
        productId: verified.productId,
        status: derivation.status,
        paidThrough: derivation.paidThrough,
        graceThrough: derivation.graceThrough,
        revokedAt: derivation.revokedAt,
        autoRenewEnabled: renewalState.autoRenewEnabled,
        billingRetry: renewalState.billingRetry,
        renewalAppliedAt: renewalState.appliedFact?.sourceAt ?? null,
        renewalAppliedRank: renewalState.appliedFact?.authorityRank ?? 0,
        renewalAppliedId: renewalState.appliedFact?.sourceId ?? null,
        lastAppleEventTime: context.sourceAt,
        lastAppleSourceId: context.sourceId,
      },
      update: {
        status: derivation.status,
        paidThrough: derivation.paidThrough,
        graceThrough: derivation.graceThrough,
        revokedAt: derivation.revokedAt,
        autoRenewEnabled: renewalState.autoRenewEnabled,
        billingRetry: renewalState.billingRetry,
        renewalAppliedAt: renewalState.appliedFact?.sourceAt ?? null,
        renewalAppliedRank: renewalState.appliedFact?.authorityRank ?? 0,
        renewalAppliedId: renewalState.appliedFact?.sourceId ?? null,
        lastAppleEventTime: greatestEventTime,
        lastAppleSourceId: greatestSourceId,
      },
    });

    await this.markTransactionApplied(transaction, row.id, now);
    return appliedNow;
  }

  private async markTransactionApplied(
    transaction: Prisma.TransactionClient,
    rowId: string,
    now: Date,
  ): Promise<void> {
    await transaction.iapTransaction.updateMany({
      where: { id: rowId, applicationStatus: { not: 'APPLIED' } },
      data: {
        applicationStatus: 'APPLIED',
        disposition: 'APPLIED',
        appliedAt: now,
      },
    });
  }

  /**
   * Records the terminal no-benefit disposition for a closed owner. A
   * transaction whose benefit was applied before the owner closed keeps its
   * historical applied disposition and reports duplicate delivery instead.
   */
  private async recordClosedOwnerTransaction(
    transaction: Prisma.TransactionClient,
    verified: VerifiedAppleTransaction,
    ownership: ResolvedOwnership,
    now: Date,
  ): Promise<boolean> {
    const row = await this.upsertTransactionRow(transaction, verified, ownership);
    const updated = await transaction.iapTransaction.updateMany({
      where: { id: row.id, disposition: { notIn: ['APPLIED'] } },
      data: {
        applicationStatus: 'APPLIED',
        disposition: 'OWNER_CLOSED_NO_BENEFIT',
        appliedAt: now,
      },
    });
    return updated.count === 0;
  }
}
