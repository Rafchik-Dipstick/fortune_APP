import {
  accountDeletionResponseSchema,
  accountDeletionStateSchema,
  type AccountDeletionRequest,
  type AccountDeletionResponse,
  type AccountDeletionState,
} from '@fortuneness/api-contracts';

import { DatabaseError } from '../db/errors.js';
import {
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { resolveSubscriptionAllowance } from '../fortune/allowance.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';

/** Deletion requires an Apple sign-in no older than this (spec 6.3). */
export const deletionAuthTimeMaxAgeSeconds = 300;

export type AccountDeletionErrorCode =
  | 'ACCOUNT_DELETION_PENDING'
  | 'ACCOUNT_PURGED'
  | 'AUTH_REQUIRED'
  | 'APPLE_ID_REAUTH_REQUIRED'
  | 'RETRYABLE_CONFLICT'
  | 'VALIDATION_FAILED';

export class AccountDeletionError extends Error {
  readonly code: AccountDeletionErrorCode;
  readonly detail: string | undefined;

  constructor(code: AccountDeletionErrorCode, detail?: string) {
    super(`Account deletion failed: ${code}.`);
    this.name = 'AccountDeletionError';
    this.code = code;
    this.detail = detail;
  }
}

export interface AccountDeletionServiceOptions {
  client: PrismaClient;
  now?: () => Date;
  purgeDelayDays?: number;
}

function serializeDeletion(request: {
  cancelledAt: Date | null;
  purgeAt: Date;
  requestedAt: Date;
  status: 'PENDING' | 'CANCELLED' | 'PURGED';
}): AccountDeletionState {
  return accountDeletionStateSchema.parse({
    status: request.status,
    requestedAt: request.requestedAt.toISOString(),
    purgeAt: request.purgeAt.toISOString(),
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
  });
}

/**
 * Account deletion request, status, and cancellation (spec section 6.3).
 *
 * The request path is deliberately narrow: a fresh Apple identity token, the
 * confirmations the situation actually requires, and a single transaction in
 * the global `User → SessionFamily` lock order that revokes every session
 * before returning. Nothing about the account remains usable afterwards, so a
 * lost response is recovered through reauthentication rather than by replaying
 * a call on a session that no longer exists.
 */
export class AccountDeletionService {
  private readonly client: PrismaClient;
  private readonly now: () => Date;
  private readonly purgeDelayDays: number;

  constructor(options: AccountDeletionServiceOptions) {
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
    this.purgeDelayDays = options.purgeDelayDays ?? 30;
  }

  async request(
    authentication: AuthenticationContext,
    confirmations: AccountDeletionRequest,
  ): Promise<AccountDeletionResponse> {
    const now = this.now();
    try {
      const deletion = await runReadCommittedTransaction(this.client, async (transaction) => {
        const user = await lockUserForUpdate(transaction, authentication.userId);
        const family = await lockSessionFamilyForUpdate(
          transaction,
          authentication.sessionFamilyId,
        );
        if (user.status === 'DELETION_PENDING') {
          throw new AccountDeletionError('ACCOUNT_DELETION_PENDING');
        }
        if (user.status === 'PURGED') {
          throw new AccountDeletionError('ACCOUNT_PURGED');
        }
        if (
          user.status !== 'ACTIVE' ||
          family.userId !== user.id ||
          family.sessionVersion !== user.sessionVersion ||
          family.sessionVersion !== authentication.sessionVersion ||
          family.revokedAt !== null ||
          family.expiresAt <= now
        ) {
          throw new AccountDeletionError('AUTH_REQUIRED');
        }

        // The authoritative proof age comes from the session family, not from
        // the token, and the token's immutable auth_time must match it.
        const authenticatedAtSeconds = Math.floor(family.identityAuthenticatedAt.getTime() / 1_000);
        if (authenticatedAtSeconds !== authentication.authTimeSeconds) {
          throw new AccountDeletionError('AUTH_REQUIRED');
        }
        const proofAgeSeconds = Math.floor(now.getTime() / 1_000) - authenticatedAtSeconds;
        if (proofAgeSeconds > deletionAuthTimeMaxAgeSeconds || proofAgeSeconds < 0) {
          throw new AccountDeletionError('APPLE_ID_REAUTH_REQUIRED');
        }

        await this.assertConfirmationsSatisfied(transaction, user, confirmations, now);

        const created = await transaction.accountDeletionRequest.create({
          data: {
            userId: user.id,
            status: 'PENDING',
            requestedAt: now,
            purgeAt: new Date(now.getTime() + this.purgeDelayDays * 86_400_000),
          },
        });

        // Access ends the moment this commits: the session version moves and
        // every family is revoked, so no already-issued token still verifies.
        await transaction.user.update({
          where: { id: user.id },
          data: {
            status: 'DELETION_PENDING',
            sessionVersion: { increment: 1 },
            updatedAt: now,
          },
        });
        await transaction.sessionFamily.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'ACCOUNT_DELETION_REQUESTED' },
        });

        return created;
      });
      return accountDeletionResponseSchema.parse({ deletion: serializeDeletion(deletion) });
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        throw error;
      }
      if (error instanceof DatabaseError && error.kind === 'UNIQUE_CONSTRAINT') {
        // A concurrent request won. The account is already pending, which is
        // exactly what a retry of the lost response should observe.
        throw new AccountDeletionError('ACCOUNT_DELETION_PENDING');
      }
      throw error;
    }
  }

  /** Deletion-management view; never returns application data. */
  async status(userId: string): Promise<AccountDeletionState> {
    const request = await this.client.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    if (request === null) {
      throw new AccountDeletionError('VALIDATION_FAILED', 'No deletion request exists.');
    }
    return serializeDeletion(request);
  }

  /**
   * Cancels a pending request. It locks the same rows the purge worker locks
   * and succeeds only while the request is still PENDING, so a cancellation
   * racing a completed purge loses cleanly rather than reopening a closed
   * financial subject.
   */
  async cancel(userId: string): Promise<{ sessionVersion: number }> {
    const now = this.now();
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, userId);
      if (user.status === 'PURGED') {
        throw new AccountDeletionError('ACCOUNT_PURGED');
      }
      const request = await transaction.accountDeletionRequest.findFirst({
        where: { userId, status: 'PENDING' },
        orderBy: { requestedAt: 'desc' },
      });
      if (request === null) {
        throw new AccountDeletionError('VALIDATION_FAILED', 'No pending deletion request exists.');
      }
      if (request.purgedAt !== null) {
        throw new AccountDeletionError('ACCOUNT_PURGED');
      }

      await transaction.accountDeletionRequest.update({
        where: { id: request.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      const restored = await transaction.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE', sessionVersion: { increment: 1 }, updatedAt: now },
      });
      return { sessionVersion: restored.sessionVersion };
    });
  }

  /**
   * The Apple-billing acknowledgement is required only when Apple currently
   * reports a subscription that may still be charged, or when the status
   * cannot be established. It is checked server-side so a client cannot skip
   * a disclosure by omitting the flag.
   */
  private async assertConfirmationsSatisfied(
    transaction: Prisma.TransactionClient,
    user: { activeFinancialSubjectId: string | null },
    confirmations: AccountDeletionRequest,
    now: Date,
  ): Promise<void> {
    if (user.activeFinancialSubjectId === null) {
      return;
    }
    const entitlements = await transaction.subscriptionEntitlement.findMany({
      where: { financialSubjectId: user.activeFinancialSubjectId },
      select: {
        graceThrough: true,
        lastAppleEventTime: true,
        paidThrough: true,
        revokedAt: true,
        status: true,
      },
    });
    const subscription = resolveSubscriptionAllowance(entitlements, now);
    const paidThrough =
      subscription.paidThrough === null ? null : new Date(subscription.paidThrough);
    const appleBillingMayContinue =
      subscription.entitled ||
      subscription.status === 'BILLING_RETRY' ||
      (paidThrough !== null && paidThrough > now);

    if (appleBillingMayContinue && confirmations.acknowledgedAppleBilling !== true) {
      throw new AccountDeletionError(
        'VALIDATION_FAILED',
        'This account has an App Store subscription that may still be billed. The Apple billing acknowledgement is required.',
      );
    }
  }
}
