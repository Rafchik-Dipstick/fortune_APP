import {
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';

export type LogoutSessionErrorCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED';

export class LogoutSessionError extends Error {
  readonly code: LogoutSessionErrorCode;

  constructor(code: LogoutSessionErrorCode) {
    super(`Session logout failed: ${code}.`);
    this.name = 'LogoutSessionError';
    this.code = code;
  }
}

export class LogoutSessionService {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async logout(authentication: AuthenticationContext): Promise<void> {
    await runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, authentication.userId);
      const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
      const now = this.now();
      if (user.status === 'DELETION_PENDING') {
        throw new LogoutSessionError('ACCOUNT_DELETION_PENDING');
      }
      if (user.status === 'PURGED') {
        throw new LogoutSessionError('ACCOUNT_PURGED');
      }
      if (
        user.status !== 'ACTIVE' ||
        family.userId !== user.id ||
        family.sessionVersion !== user.sessionVersion ||
        family.sessionVersion !== authentication.sessionVersion ||
        family.revokedAt !== null ||
        family.expiresAt <= now ||
        Math.floor(family.identityAuthenticatedAt.getTime() / 1_000) !==
          authentication.authTimeSeconds
      ) {
        throw new LogoutSessionError('AUTH_REQUIRED');
      }
      await transaction.sessionFamily.update({
        where: { id: family.id },
        data: { revokedAt: now, revocationReason: 'LOGOUT' },
      });
    });
  }
}
