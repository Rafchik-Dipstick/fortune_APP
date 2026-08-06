import {
  fortuneStateResponseSchema,
  type FortuneDraw,
  type FortuneStateResponse,
} from '@fortuneness/api-contracts';

import {
  lockFinancialSubjectForUpdate,
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
  type LockedFinancialSubject,
} from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { calculateAllowanceAvailability } from './allowance.js';
import { ensureCurrentAllowancePeriod } from './periods.js';

export type FortuneStateErrorCode = 'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED';

export class FortuneStateError extends Error {
  readonly code: FortuneStateErrorCode;

  constructor(code: FortuneStateErrorCode, cause?: unknown) {
    super(`Fortune state failed: ${code}.`, { cause });
    this.name = 'FortuneStateError';
    this.code = code;
  }
}

type StoredFortuneDraw = Prisma.FortuneDrawGetPayload<Record<string, never>>;

export function serializeFortuneDraw(draw: StoredFortuneDraw): FortuneDraw {
  return {
    id: draw.id,
    cardKey: draw.cardKey,
    cardDisplayNumber: draw.cardDisplayNumber,
    cardName: draw.cardNameSnapshot,
    orientation: draw.orientation,
    intention: draw.intention,
    resolvedLocale: draw.resolvedLocale,
    artAltText: draw.illustrationAltSnapshot,
    headline: draw.headlineSnapshot,
    message: draw.messageSnapshot,
    action: draw.gentleActionSnapshot,
    affirmation: draw.affirmationSnapshot,
    allowanceSource: draw.allowanceSource,
    contentVersion: draw.contentVersionSnapshot,
    issuedAt: draw.issuedAt.toISOString(),
    viewedAt: draw.viewedAt?.toISOString() ?? null,
  };
}

export async function loadFortuneState(
  transaction: Prisma.TransactionClient,
  userId: string,
  financialSubject: LockedFinancialSubject,
  now: Date,
): Promise<FortuneStateResponse> {
  if (financialSubject.benefitsDisabledAt !== null) {
    throw new FortuneStateError('AUTH_REQUIRED');
  }
  const current = await ensureCurrentAllowancePeriod(transaction, userId, now);
  const [creditBalance, entitlements, unviewedDraw] = await Promise.all([
    transaction.creditLedgerEntry.aggregate({
      where: { financialSubjectId: financialSubject.id },
      _sum: { delta: true },
    }),
    transaction.subscriptionEntitlement.findMany({
      where: { financialSubjectId: financialSubject.id },
      select: {
        graceThrough: true,
        lastAppleEventTime: true,
        paidThrough: true,
        revokedAt: true,
        status: true,
      },
    }),
    transaction.fortuneDraw.findFirst({
      where: { userId, viewedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const spendablePackCredits = creditBalance._sum.delta ?? 0;
  if (spendablePackCredits < 0) {
    throw new RangeError('The append-only credit ledger cannot have a negative balance.');
  }
  const availability = calculateAllowanceAvailability({
    entitlements,
    freeUsed: current.period.usage?.freeUsed ?? 0,
    now,
    spendablePackCredits,
    subscriptionUsed: current.period.usage?.subscriptionUsed ?? 0,
  });
  return fortuneStateResponseSchema.parse({
    state: {
      serverTime: now.toISOString(),
      ...availability,
      allowancePeriodId: current.period.id,
      currentPeriodStartedAt: current.period.startedAt.toISOString(),
      nextResetAt: current.period.resetAt.toISOString(),
      accountTimeZone: current.user.accountTimeZone,
      reportedDeviceTimeZone: current.user.reportedDeviceTimeZone,
      pendingTimeZone: current.user.pendingTimeZone,
      timeZoneEffectiveAt: current.user.timeZoneEffectiveAt?.toISOString() ?? null,
      nextTimeZoneChangeEligibleAt:
        current.user.nextTimeZoneChangeEligibleAt?.toISOString() ?? null,
    },
    unviewedDraw: unviewedDraw === null ? null : serializeFortuneDraw(unviewedDraw),
  });
}

export class FortuneStateService {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(authentication: AuthenticationContext): Promise<FortuneStateResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, authentication.userId);
      const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
      const now = this.now();
      if (user.status === 'DELETION_PENDING') {
        throw new FortuneStateError('ACCOUNT_DELETION_PENDING');
      }
      if (user.status === 'PURGED') {
        throw new FortuneStateError('ACCOUNT_PURGED');
      }
      if (
        user.status !== 'ACTIVE' ||
        family.userId !== user.id ||
        family.sessionVersion !== user.sessionVersion ||
        family.sessionVersion !== authentication.sessionVersion ||
        family.revokedAt !== null ||
        family.expiresAt <= now ||
        Math.floor(family.gameCenterAuthenticatedAt.getTime() / 1_000) !==
          authentication.authTimeSeconds ||
        user.activeFinancialSubjectId === null
      ) {
        throw new FortuneStateError('AUTH_REQUIRED');
      }
      const financialSubject = await lockFinancialSubjectForUpdate(
        transaction,
        user.activeFinancialSubjectId,
      );
      return loadFortuneState(transaction, user.id, financialSubject, now);
    });
  }
}
