import {
  iapCatalogResponseSchema,
  iapStatusResponseSchema,
  type IapCallerState,
  type IapCatalogResponse,
  type IapReconcileDisposition,
  type IapReconcileResponse,
  type IapStatusResponse,
  type IapTransactionResponse,
} from '@fortuneness/api-contracts';

import { type CommerceEnvironment } from '../config/environment.js';
import {
  lockFinancialSubjectForUpdate,
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
  type LockedFinancialSubject,
  type LockedUser,
} from '../db/transactions.js';
import { resolveSubscriptionAllowance } from '../fortune/allowance.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import {
  IapApplicationError,
  type IapApplicationService,
  type TransactionApplicationOutcome,
} from './application.js';
import { resolveCurrentPurchaseToken, type PurchaseTokenKeys } from './purchase-token.js';
import {
  SignedTransactionVerificationError,
  type SignedTransactionVerifier,
  type VerifiedAppleTransaction,
} from './verification.js';

export type CommerceErrorCode =
  | 'ACCOUNT_DELETION_PENDING'
  | 'ACCOUNT_PURGED'
  | 'AUTH_REQUIRED'
  | 'PRODUCT_NOT_ALLOWED'
  | 'RETRYABLE_CONFLICT'
  | 'TRANSACTION_OWNER_UNKNOWN'
  | 'TRANSACTION_UNVERIFIED';

export class CommerceError extends Error {
  readonly code: CommerceErrorCode;

  constructor(code: CommerceErrorCode, cause?: unknown) {
    super(`Commerce operation failed: ${code}.`, { cause });
    this.name = 'CommerceError';
    this.code = code;
  }
}

interface CommerceServiceOptions {
  application: IapApplicationService;
  client: PrismaClient;
  commerce: CommerceEnvironment;
  now?: () => Date;
  tokenKeys: PurchaseTokenKeys;
  verifier: SignedTransactionVerifier;
}

interface AuthorizedCaller {
  financialSubject: LockedFinancialSubject;
  now: Date;
  user: LockedUser;
}

export class CommerceService {
  private readonly application: IapApplicationService;
  private readonly client: PrismaClient;
  private readonly commerce: CommerceEnvironment;
  private readonly now: () => Date;
  private readonly tokenKeys: PurchaseTokenKeys;
  private readonly verifier: SignedTransactionVerifier;

  constructor(options: CommerceServiceOptions) {
    this.application = options.application;
    this.client = options.client;
    this.commerce = options.commerce;
    this.now = options.now ?? (() => new Date());
    this.tokenKeys = options.tokenKeys;
    this.verifier = options.verifier;
  }

  async catalog(authentication: AuthenticationContext): Promise<IapCatalogResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const caller = await this.assertAuthorized(transaction, authentication);
      const token = await resolveCurrentPurchaseToken(
        transaction,
        caller.financialSubject.id,
        this.tokenKeys,
        caller.now,
      );
      return iapCatalogResponseSchema.parse({
        products: [
          { productId: this.commerce.fortunePack10ProductId, productType: 'CONSUMABLE' },
          {
            productId: this.commerce.oraclePlusMonthlyProductId,
            productType: 'AUTO_RENEWABLE_SUBSCRIPTION',
          },
        ],
        benefits: [
          {
            productId: this.commerce.fortunePack10ProductId,
            kind: 'PACK_CREDITS',
            units: 10,
            title: '10 Fortune Pack',
            description:
              'Adds exactly 10 spendable draw credits after server verification. Unused credits remain until spent or adjusted after a verified refund.',
          },
          {
            productId: this.commerce.oraclePlusMonthlyProductId,
            kind: 'SUBSCRIPTION_DAILY_FORTUNES',
            units: 10,
            title: 'Oracle+ Monthly',
            description:
              'Adds 10 fortunes per eligible account day while the verified subscription is active or in a verified grace period. Auto-renews monthly until cancelled.',
          },
        ],
        gracePeriodPolicy: {
          enabled: true,
          description:
            'If a renewal payment fails, verified billing grace keeps subscriber benefits until the grace expiration Apple reports.',
        },
        appAccountToken: token.token,
      });
    });
  }

  async status(authentication: AuthenticationContext): Promise<IapStatusResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const caller = await this.assertAuthorized(transaction, authentication);
      return iapStatusResponseSchema.parse(
        await this.callerState(transaction, caller, authentication.userId),
      );
    });
  }

  async deliver(
    authentication: AuthenticationContext,
    signedTransaction: string,
  ): Promise<IapTransactionResponse> {
    const verified = await this.verify(signedTransaction);
    const callerSubjectId = await this.callerFinancialSubjectId(authentication);

    let outcome: TransactionApplicationOutcome;
    try {
      outcome = await this.application.apply(verified, {
        authorityRank: 0,
        sourceAt: verified.signedAt,
        sourceId: `client:${verified.transactionId}`,
      });
    } catch (error) {
      throw this.mapApplicationError(error);
    }

    return this.mapOutcome(outcome, callerSubjectId, authentication);
  }

  async reconcile(
    authentication: AuthenticationContext,
    signedTransactions: readonly string[],
  ): Promise<IapReconcileResponse> {
    const callerSubjectId = await this.callerFinancialSubjectId(authentication);
    const dispositions: IapReconcileDisposition[] = [];

    for (const [index, signedTransaction] of signedTransactions.entries()) {
      let verified: VerifiedAppleTransaction;
      try {
        verified = await this.verify(signedTransaction);
      } catch (error) {
        dispositions.push({
          index,
          transactionId: null,
          deliveryAccepted: false,
          safeToFinish: false,
          disposition: 'REJECTED',
          errorCode:
            error instanceof CommerceError && error.code === 'PRODUCT_NOT_ALLOWED'
              ? 'PRODUCT_NOT_ALLOWED'
              : 'TRANSACTION_UNVERIFIED',
        });
        continue;
      }

      try {
        const outcome = await this.application.apply(verified, {
          authorityRank: 0,
          sourceAt: verified.signedAt,
          sourceId: `client:${verified.transactionId}`,
        });
        const mapped = this.mapOutcomeShape(outcome, callerSubjectId);
        dispositions.push({ index, ...mapped });
      } catch (error) {
        const commerceError = this.mapApplicationError(error);
        if (
          commerceError.code !== 'TRANSACTION_OWNER_UNKNOWN' &&
          commerceError.code !== 'RETRYABLE_CONFLICT'
        ) {
          throw commerceError;
        }
        dispositions.push({
          index,
          transactionId: verified.transactionId,
          deliveryAccepted: false,
          safeToFinish: false,
          disposition: 'REJECTED',
          errorCode: commerceError.code,
        });
      }
    }

    const callerState = await runReadCommittedTransaction(this.client, async (transaction) => {
      const caller = await this.assertAuthorized(transaction, authentication);
      return this.callerState(transaction, caller, authentication.userId);
    });

    return { dispositions, callerState };
  }

  private async verify(signedTransaction: string): Promise<VerifiedAppleTransaction> {
    try {
      return await this.verifier.verifyTransaction(signedTransaction);
    } catch (error) {
      if (error instanceof SignedTransactionVerificationError) {
        throw new CommerceError(error.code, error);
      }
      throw error;
    }
  }

  private mapApplicationError(error: unknown): CommerceError {
    if (error instanceof CommerceError) {
      return error;
    }
    if (error instanceof IapApplicationError) {
      switch (error.code) {
        case 'TRANSACTION_OWNER_UNKNOWN':
          return new CommerceError('TRANSACTION_OWNER_UNKNOWN', error);
        case 'RETRYABLE_CONFLICT':
          return new CommerceError('RETRYABLE_CONFLICT', error);
        case 'INTERNAL_CONFLICT':
          throw error;
      }
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unexpected commerce application failure.', { cause: error });
  }

  private async mapOutcome(
    outcome: TransactionApplicationOutcome,
    callerSubjectId: string,
    authentication: AuthenticationContext,
  ): Promise<IapTransactionResponse> {
    const shape = this.mapOutcomeShape(outcome, callerSubjectId);
    if (shape.disposition === 'APPLIED' || shape.disposition === 'ALREADY_APPLIED') {
      const callerState = await runReadCommittedTransaction(this.client, async (transaction) => {
        const caller = await this.assertAuthorized(transaction, authentication);
        return this.callerState(transaction, caller, authentication.userId);
      });
      return { ...shape, callerState };
    }
    return shape;
  }

  /**
   * Maps an application outcome to the caller-visible discriminated shape.
   * Another owner is always reported as privacy-safe delivery, never with
   * that owner's closure or state.
   */
  private mapOutcomeShape(
    outcome: TransactionApplicationOutcome,
    callerSubjectId: string,
  ):
    | {
        transactionId: string;
        deliveryAccepted: true;
        safeToFinish: true;
        appliedNow: true;
        disposition: 'APPLIED';
      }
    | {
        transactionId: string;
        deliveryAccepted: true;
        safeToFinish: true;
        appliedNow: false;
        disposition: 'ALREADY_APPLIED' | 'DELIVERED_TO_OTHER_ACCOUNT' | 'OWNER_CLOSED_NO_BENEFIT';
      } {
    const base = {
      transactionId: outcome.transactionId,
      deliveryAccepted: true,
      safeToFinish: true,
    } as const;

    if (outcome.ownerFinancialSubjectId !== callerSubjectId) {
      return { ...base, appliedNow: false, disposition: 'DELIVERED_TO_OTHER_ACCOUNT' };
    }
    if (outcome.ownerClosed) {
      return { ...base, appliedNow: false, disposition: 'OWNER_CLOSED_NO_BENEFIT' };
    }
    if (outcome.appliedNow) {
      return { ...base, appliedNow: true, disposition: 'APPLIED' };
    }
    return { ...base, appliedNow: false, disposition: 'ALREADY_APPLIED' };
  }

  private async callerFinancialSubjectId(authentication: AuthenticationContext): Promise<string> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const caller = await this.assertAuthorized(transaction, authentication);
      return caller.financialSubject.id;
    });
  }

  private async callerState(
    transaction: Prisma.TransactionClient,
    caller: AuthorizedCaller,
    userId: string,
  ): Promise<IapCallerState> {
    const closed = caller.financialSubject.benefitsDisabledAt !== null;
    const [creditBalance, entitlements, user] = await Promise.all([
      transaction.creditLedgerEntry.aggregate({
        where: { financialSubjectId: caller.financialSubject.id },
        _sum: { delta: true },
      }),
      transaction.subscriptionEntitlement.findMany({
        where: { financialSubjectId: caller.financialSubject.id },
        select: {
          graceThrough: true,
          lastAppleEventTime: true,
          paidThrough: true,
          revokedAt: true,
          status: true,
        },
      }),
      transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { commerceReviewRequired: true },
      }),
    ]);

    const subscription = closed
      ? { status: 'NONE' as const, entitled: false, paidThrough: null, graceThrough: null }
      : resolveSubscriptionAllowance(entitlements, caller.now);

    return {
      subscription,
      spendablePackCredits: closed ? 0 : Math.max(creditBalance._sum.delta ?? 0, 0),
      commerceReviewRequired: user.commerceReviewRequired,
    };
  }

  private async assertAuthorized(
    transaction: Prisma.TransactionClient,
    authentication: AuthenticationContext,
  ): Promise<AuthorizedCaller> {
    const user = await lockUserForUpdate(transaction, authentication.userId);
    const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
    const now = this.now();
    if (user.status === 'DELETION_PENDING') {
      throw new CommerceError('ACCOUNT_DELETION_PENDING');
    }
    if (user.status === 'PURGED') {
      throw new CommerceError('ACCOUNT_PURGED');
    }
    if (
      user.status !== 'ACTIVE' ||
      family.userId !== user.id ||
      family.sessionVersion !== user.sessionVersion ||
      family.sessionVersion !== authentication.sessionVersion ||
      family.revokedAt !== null ||
      family.expiresAt <= now ||
      Math.floor(family.identityAuthenticatedAt.getTime() / 1_000) !==
        authentication.authTimeSeconds ||
      user.activeFinancialSubjectId === null
    ) {
      throw new CommerceError('AUTH_REQUIRED');
    }
    const financialSubject = await lockFinancialSubjectForUpdate(
      transaction,
      user.activeFinancialSubjectId,
    );
    return { financialSubject, now, user };
  }
}
