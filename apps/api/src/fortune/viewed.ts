import {
  fortuneViewedResponseSchema,
  type FortuneViewedResponse,
} from '@fortuneness/api-contracts';

import {
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { serializeFortuneDraw } from './state.js';

export type FortuneViewedErrorCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED' | 'NOT_FOUND';

export class FortuneViewedError extends Error {
  readonly code: FortuneViewedErrorCode;

  constructor(code: FortuneViewedErrorCode) {
    super(`Fortune viewed acknowledgement failed: ${code}.`);
    this.name = 'FortuneViewedError';
    this.code = code;
  }
}

export class FortuneViewedService {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async markViewed(
    authentication: AuthenticationContext,
    drawId: string,
  ): Promise<FortuneViewedResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, authentication.userId);
      const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
      const now = this.now();
      if (user.status === 'DELETION_PENDING') {
        throw new FortuneViewedError('ACCOUNT_DELETION_PENDING');
      }
      if (user.status === 'PURGED') {
        throw new FortuneViewedError('ACCOUNT_PURGED');
      }
      if (
        user.status !== 'ACTIVE' ||
        family.userId !== user.id ||
        family.sessionVersion !== user.sessionVersion ||
        family.sessionVersion !== authentication.sessionVersion ||
        family.revokedAt !== null ||
        family.expiresAt <= now ||
        Math.floor(family.gameCenterAuthenticatedAt.getTime() / 1_000) !==
          authentication.authTimeSeconds
      ) {
        throw new FortuneViewedError('AUTH_REQUIRED');
      }
      const draw = await transaction.fortuneDraw.findFirst({
        where: { id: drawId, userId: user.id },
      });
      if (draw === null) {
        throw new FortuneViewedError('NOT_FOUND');
      }
      const viewed =
        draw.viewedAt === null
          ? await transaction.fortuneDraw.update({
              where: { id: draw.id },
              data: { viewedAt: now < draw.issuedAt ? draw.issuedAt : now },
            })
          : draw;
      return fortuneViewedResponseSchema.parse({ draw: serializeFortuneDraw(viewed) });
    });
  }
}
