import { meResponseSchema, type MeResponse } from '@fortuneness/api-contracts';

import { type AuthenticationEnvironment } from '../config/environment.js';
import {
  lockFinancialSubjectForUpdate,
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { decryptBytes } from '../security/crypto.js';
import { serializeAuthenticatedUser } from './game-center-login.js';

const purchaseTokenContextPrefix = 'app-account-token:';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
      const binding = await transaction.appAccountTokenBinding.findFirst({
        where: {
          financialSubjectId: userLock.activeFinancialSubjectId,
          validTo: null,
          cryptoErasedAt: null,
          encryptedToken: { not: null },
        },
        orderBy: { validFrom: 'desc' },
      });
      if (binding === null) {
        throw new AccountBootstrapError('AUTH_REQUIRED');
      }
      if (binding.encryptedToken === null || binding.encryptionKeyVersion === null) {
        throw new AccountBootstrapError('AUTH_REQUIRED');
      }

      let appAccountToken: string;
      try {
        appAccountToken = decryptBytes(
          Buffer.from(binding.encryptedToken),
          binding.encryptionKeyVersion,
          this.environment.appAccountTokenEncryptionKeys,
          `${purchaseTokenContextPrefix}${binding.id}`,
        ).toString('utf8');
      } catch (error) {
        throw new AccountBootstrapError('AUTH_REQUIRED', error);
      }
      if (!uuidPattern.test(appAccountToken)) {
        throw new AccountBootstrapError('AUTH_REQUIRED');
      }

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
