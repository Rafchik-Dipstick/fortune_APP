import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';
import {
  apiPaths,
  fortuneDrawResponseSchema,
  noDrawsAvailableDetailsSchema,
  unviewedReadingPendingDetailsSchema,
  type FortuneDrawRequest,
  type FortuneDrawResponse,
} from '@fortuneness/api-contracts';

import { DatabaseError } from '../db/errors.js';
import {
  lockFinancialSubjectForUpdate,
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { selectAllowanceSource } from './allowance.js';
import {
  CryptographicFortuneRandomSource,
  FortuneContentUnavailableError,
  selectFortuneContent,
  type FortuneRandomSource,
} from './selection.js';
import { loadFortuneState, serializeFortuneDraw } from './state.js';

const recentTemplateWindowMs = 30 * 86_400_000;
const idempotencyMethod = 'POST';
const totalDeckCards = 78;

const storedDrawOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SUCCESS'), response: fortuneDrawResponseSchema }).strict(),
  z
    .object({ kind: z.literal('NO_DRAWS_AVAILABLE'), details: noDrawsAvailableDetailsSchema })
    .strict(),
  z
    .object({
      kind: z.literal('UNVIEWED_READING_PENDING'),
      details: unviewedReadingPendingDetailsSchema,
    })
    .strict(),
]);

type StoredDrawOutcome = z.infer<typeof storedDrawOutcomeSchema>;

export type FortuneDrawErrorCode =
  | 'ACCOUNT_DELETION_PENDING'
  | 'ACCOUNT_PURGED'
  | 'AUTH_REQUIRED'
  | 'CONTENT_UNAVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'NO_DRAWS_AVAILABLE'
  | 'UNVIEWED_READING_PENDING';

export class FortuneDrawError extends Error {
  readonly code: FortuneDrawErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: FortuneDrawErrorCode, details?: Record<string, unknown>, cause?: unknown) {
    super(`Fortune draw failed: ${code}.`, { cause });
    this.name = 'FortuneDrawError';
    this.code = code;
    this.details = details;
  }
}

export interface FortuneDrawResult {
  created: boolean;
  response: FortuneDrawResponse;
}

interface FortuneDrawServiceOptions {
  client: PrismaClient;
  now?: () => Date;
  random?: FortuneRandomSource;
  uuidFactory?: () => string;
}

function canonicalRequestHash(request: FortuneDrawRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ intention: request.intention }))
    .digest('hex');
}

function toInputJson(value: StoredDrawOutcome): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function resolveCommittedOutcome(outcome: StoredDrawOutcome, created: boolean): FortuneDrawResult {
  switch (outcome.kind) {
    case 'SUCCESS':
      return { created, response: outcome.response };
    case 'NO_DRAWS_AVAILABLE':
      throw new FortuneDrawError('NO_DRAWS_AVAILABLE', { state: outcome.details.state });
    case 'UNVIEWED_READING_PENDING':
      throw new FortuneDrawError('UNVIEWED_READING_PENDING', {
        state: outcome.details.state,
        unviewedDraw: outcome.details.unviewedDraw,
      });
  }
}

export class FortuneDrawService {
  private readonly client: PrismaClient;
  private readonly now: () => Date;
  private readonly random: FortuneRandomSource;
  private readonly uuidFactory: () => string;

  constructor(options: FortuneDrawServiceOptions) {
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? new CryptographicFortuneRandomSource();
    this.uuidFactory = options.uuidFactory ?? randomUUID;
  }

  async draw(
    authentication: AuthenticationContext,
    request: FortuneDrawRequest,
    idempotencyKey: string,
  ): Promise<FortuneDrawResult> {
    const requestHash = canonicalRequestHash(request);
    try {
      const committed = await runReadCommittedTransaction(this.client, async (transaction) => {
        const user = await lockUserForUpdate(transaction, authentication.userId);
        const family = await lockSessionFamilyForUpdate(
          transaction,
          authentication.sessionFamilyId,
        );
        const now = this.now();
        this.assertAuthorized(user, family, authentication, now);
        const existing = await transaction.idempotencyRecord.findFirst({
          where: {
            actorType: 'USER',
            actorId: user.id,
            method: idempotencyMethod,
            normalizedRoute: apiPaths.fortuneDraw,
            key: idempotencyKey,
          },
        });
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            throw new FortuneDrawError('IDEMPOTENCY_KEY_REUSED');
          }
          return {
            created: false,
            outcome: storedDrawOutcomeSchema.parse(existing.responseSnapshot),
          };
        }

        const unviewedDraw = await transaction.fortuneDraw.findFirst({
          where: { userId: user.id, viewedAt: null },
          orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        });
        if (user.activeFinancialSubjectId === null) {
          throw new FortuneDrawError('AUTH_REQUIRED');
        }
        const financialSubject = await lockFinancialSubjectForUpdate(
          transaction,
          user.activeFinancialSubjectId,
        );
        const before = await loadFortuneState(transaction, user.id, financialSubject, now);
        if (unviewedDraw !== null) {
          const outcome: StoredDrawOutcome = {
            kind: 'UNVIEWED_READING_PENDING',
            details: {
              state: before.state,
              unviewedDraw: serializeFortuneDraw(unviewedDraw),
            },
          };
          await this.storeOutcome(transaction, user.id, idempotencyKey, requestHash, outcome, {
            httpStatus: 409,
            resultReference: unviewedDraw.id,
          });
          return { created: false, outcome };
        }

        const allowanceSource = selectAllowanceSource({
          availableDraws: before.state.availableDraws,
          freeRemaining: before.state.freeRemaining,
          spendablePackCredits: before.state.spendablePackCredits,
          subscription: before.state.subscription,
          subscriptionRemaining: before.state.subscriptionRemaining,
        });
        if (allowanceSource === undefined) {
          const outcome: StoredDrawOutcome = {
            kind: 'NO_DRAWS_AVAILABLE',
            details: { state: before.state },
          };
          await this.storeOutcome(transaction, user.id, idempotencyKey, requestHash, outcome, {
            httpStatus: 409,
          });
          return { created: false, outcome };
        }

        const fullUser = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
        const selected = await this.selectContent(
          transaction,
          user.id,
          fullUser.resolvedLocale,
          request,
          now,
        );
        const previousDraw = await transaction.fortuneDraw.findFirst({
          where: { userId: user.id },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        });
        const drawId = this.uuidFactory();
        const draw = await transaction.fortuneDraw.create({
          data: {
            id: drawId,
            userId: user.id,
            cardKey: selected.cardKey,
            templateId: selected.id,
            allowancePeriodId: before.state.allowancePeriodId,
            allowanceSource,
            intention: request.intention,
            orientation: selected.orientation,
            resolvedLocale: selected.locale,
            sequence: (previousDraw?.sequence ?? 0n) + 1n,
            cardDisplayNumber: selected.card.displayNumber,
            cardNameSnapshot: selected.card.nameEn,
            illustrationAltSnapshot: selected.card.illustrationAltEn,
            headlineSnapshot: selected.headline,
            messageSnapshot: selected.message,
            gentleActionSnapshot: selected.gentleAction,
            affirmationSnapshot: selected.affirmation,
            contentVersionSnapshot: selected.contentVersion,
            issuedAt: now,
            clientIdempotencyKey: idempotencyKey,
            requestHash,
          },
        });
        await this.consumeAllowance(transaction, {
          allowancePeriodId: before.state.allowancePeriodId,
          allowanceSource,
          balanceBefore: before.state.spendablePackCredits,
          drawId,
          financialSubjectId: financialSubject.id,
        });
        const after = await loadFortuneState(transaction, user.id, financialSubject, now);
        const response = fortuneDrawResponseSchema.parse({
          draw: serializeFortuneDraw(draw),
          state: after.state,
        });
        const outcome: StoredDrawOutcome = { kind: 'SUCCESS', response };
        await this.storeOutcome(transaction, user.id, idempotencyKey, requestHash, outcome, {
          httpStatus: 201,
          resultReference: draw.id,
        });
        return { created: true, outcome };
      });
      return resolveCommittedOutcome(committed.outcome, committed.created);
    } catch (error) {
      if (error instanceof FortuneContentUnavailableError) {
        throw new FortuneDrawError('CONTENT_UNAVAILABLE', undefined, error);
      }
      if (error instanceof DatabaseError && error.kind === 'UNIQUE_CONSTRAINT') {
        const committed = await this.replayAfterUniqueConstraint(
          authentication,
          idempotencyKey,
          requestHash,
        );
        if (committed !== undefined) {
          return resolveCommittedOutcome(committed, false);
        }
      }
      throw error;
    }
  }

  private async replayAfterUniqueConstraint(
    authentication: AuthenticationContext,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StoredDrawOutcome | undefined> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, authentication.userId);
      const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
      this.assertAuthorized(user, family, authentication, this.now());
      const record = await transaction.idempotencyRecord.findFirst({
        where: {
          actorType: 'USER',
          actorId: user.id,
          method: idempotencyMethod,
          normalizedRoute: apiPaths.fortuneDraw,
          key: idempotencyKey,
        },
      });
      if (record === null) {
        return undefined;
      }
      if (record.requestHash !== requestHash) {
        throw new FortuneDrawError('IDEMPOTENCY_KEY_REUSED');
      }
      return storedDrawOutcomeSchema.parse(record.responseSnapshot);
    });
  }

  private assertAuthorized(
    user: Awaited<ReturnType<typeof lockUserForUpdate>>,
    family: Awaited<ReturnType<typeof lockSessionFamilyForUpdate>>,
    authentication: AuthenticationContext,
    now: Date,
  ): void {
    if (user.status === 'DELETION_PENDING') {
      throw new FortuneDrawError('ACCOUNT_DELETION_PENDING');
    }
    if (user.status === 'PURGED') {
      throw new FortuneDrawError('ACCOUNT_PURGED');
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
      throw new FortuneDrawError('AUTH_REQUIRED');
    }
  }

  private async selectContent(
    transaction: Prisma.TransactionClient,
    userId: string,
    resolvedLocale: string,
    request: FortuneDrawRequest,
    now: Date,
  ) {
    const candidates = await transaction.fortuneTemplate.findMany({
      where: {
        active: true,
        locale: resolvedLocale,
        intention: request.intention,
        card: { active: true },
      },
      include: { card: true },
    });
    const recentTemplateRows = await transaction.fortuneDraw.findMany({
      where: { userId, issuedAt: { gte: new Date(now.getTime() - recentTemplateWindowMs) } },
      select: { templateId: true },
    });
    const recentCardRows = await transaction.fortuneDraw.findMany({
      where: { userId },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: { cardKey: true },
    });
    const unlockedRows = await transaction.fortuneDraw.findMany({
      where: { userId },
      distinct: ['cardKey'],
      select: { cardKey: true },
    });
    const deckCardCount = await transaction.tarotCard.count();
    if (deckCardCount !== totalDeckCards) {
      throw new FortuneContentUnavailableError();
    }
    return selectFortuneContent(
      {
        candidates: candidates.map((candidate) => ({
          ...candidate,
          templateId: candidate.id,
        })),
        intention: request.intention,
        recentCardKeys: new Set(recentCardRows.map(({ cardKey }) => cardKey)),
        recentTemplateIds: new Set(recentTemplateRows.map(({ templateId }) => templateId)),
        totalDeckCards: deckCardCount,
        unlockedCardKeys: new Set(unlockedRows.map(({ cardKey }) => cardKey)),
      },
      this.random,
    ).candidate;
  }

  private async consumeAllowance(
    transaction: Prisma.TransactionClient,
    options: {
      allowancePeriodId: string;
      allowanceSource: 'FREE_DAILY' | 'PACK_CREDIT' | 'SUBSCRIPTION_DAILY';
      balanceBefore: number;
      drawId: string;
      financialSubjectId: string;
    },
  ): Promise<void> {
    if (options.allowanceSource === 'FREE_DAILY') {
      await transaction.allowanceUsage.update({
        where: { allowancePeriodId: options.allowancePeriodId },
        data: { freeUsed: { increment: 1 } },
      });
      return;
    }
    if (options.allowanceSource === 'SUBSCRIPTION_DAILY') {
      await transaction.allowanceUsage.update({
        where: { allowancePeriodId: options.allowancePeriodId },
        data: { subscriptionUsed: { increment: 1 } },
      });
      return;
    }
    const grants = await transaction.packCreditGrant.findMany({
      where: {
        financialSubjectId: options.financialSubjectId,
        disposition: { in: ['ACTIVE', 'PARTIALLY_REFUNDED'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const grant = grants.find(
      (candidate) =>
        candidate.originalUnits - candidate.drawnUnits - candidate.currentRefundedUnspentUnits > 0,
    );
    if (grant === undefined || options.balanceBefore < 1) {
      throw new RangeError('The pack-credit ledger and grant availability disagree.');
    }
    await transaction.packCreditGrant.update({
      where: { id: grant.id },
      data: { drawnUnits: { increment: 1 } },
    });
    await transaction.creditLedgerEntry.create({
      data: {
        financialSubjectId: options.financialSubjectId,
        delta: -1,
        balanceAfter: options.balanceBefore - 1,
        reason: 'FORTUNE_DRAW',
        grantId: grant.id,
        drawId: options.drawId,
        effectKey: `draw:${options.drawId}`,
      },
    });
  }

  private async storeOutcome(
    transaction: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
    outcome: StoredDrawOutcome,
    result: { httpStatus: number; resultReference?: string },
  ): Promise<void> {
    await transaction.idempotencyRecord.create({
      data: {
        actorType: 'USER',
        actorId: userId,
        method: idempotencyMethod,
        normalizedRoute: apiPaths.fortuneDraw,
        key: idempotencyKey,
        requestHash,
        outcomeStatus: 'COMPLETED',
        httpStatus: result.httpStatus,
        ...(result.resultReference === undefined
          ? {}
          : { resultReference: result.resultReference }),
        responseSnapshot: toInputJson(outcome),
      },
    });
  }
}
