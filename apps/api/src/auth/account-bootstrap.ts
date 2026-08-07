import { meResponseSchema, type MeResponse } from '@fortuneness/api-contracts';

import { type AuthenticationEnvironment } from '../config/environment.js';
import {
  lockFinancialSubjectForUpdate,
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { resolveCurrentPurchaseToken } from '../iap/purchase-token.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { serializeAuthenticatedUser } from './game-center-login.js';

export type AccountBootstrapErrorCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED';

export class AccountBootstrapError extends Error {
  readonly code: AccountBootstrapErrorCode;

  constructor(code: AccountBootstrapErrorCode, cause?: unknown) {
    super(`Account bootstrap failed: ${code}.`, { cause });
    this.name = 'AccountBootstrapError';
    this.code = code;
  }
}

export class AccountBootstrapService {
  constructor(
    private readonly client: PrismaClient,
    private readonly environment: AuthenticationEnvironment,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(authentication: AuthenticationContext): Promise<MeResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const userLock = await lockUserForUpdate(transaction, authentication.userId);
      const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
      const now = this.now();
      if (userLock.status === 'DELETION_PENDING') {
        throw new AccountBootstrapError('ACCOUNT_DELETION_PENDING');
      }
      if (userLock.status === 'PURGED') {
        throw new AccountBootstrapError('ACCOUNT_PURGED');
      }
      if (
        userLock.status !== 'ACTIVE' ||
        family.userId !== userLock.id ||
        family.sessionVersion !== userLock.sessionVersion ||
        family.sessionVersion !== authentication.sessionVersion ||
        family.revokedAt !== null ||
        family.expiresAt <= now ||
        Math.floor(family.gameCenterAuthenticatedAt.getTime() / 1_000) !==
          authentication.authTimeSeconds ||
        userLock.activeFinancialSubjectId === null
      ) {
        throw new AccountBootstrapError('AUTH_REQUIRED');
      }
      await lockFinancialSubjectForUpdate(transaction, userLock.activeFinancialSubjectId);
      const user = await transaction.user.findUniqueOrThrow({ where: { id: userLock.id } });
      // Delegating to the reconciliation-side implementation keeps every
      // reader and writer of appAccountToken bindings on one convention; it
      // also mints or rotates a binding when none is recoverable, so bootstrap
      // never strands a session that login would have healed.
      const { token: appAccountToken } = await resolveCurrentPurchaseToken(
        transaction,
        userLock.activeFinancialSubjectId,
        {
          encryptionKeys: this.environment.appAccountTokenEncryptionKeys,
          hmacKeys: this.environment.appAccountTokenHmacKeys,
        },
        now,
      );

      return meResponseSchema.parse({
        user: serializeAuthenticatedUser(user),
        bootstrap: {
          serverTime: now.toISOString(),
          reportedDeviceLocale: user.reportedDeviceLocale,
          reportedDeviceTimeZone: user.reportedDeviceTimeZone,
          appAccountToken,
        },
      });
    });
  }
}
