import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { type AllowanceSource } from '@fortuneness/api-contracts';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { IapApplicationService } from '../iap/application.js';
import { findBindingByToken, resolveCurrentPurchaseToken } from '../iap/purchase-token.js';
import { type VerifiedAppleTransaction } from '../iap/verification.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { FortuneDrawService } from './draw.js';
import { FortuneStateService } from './state.js';
import { FortuneViewedService } from './viewed.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const environment = createTestApiEnvironment();
const tokenKeys = {
  encryptionKeys: environment.authentication.appAccountTokenEncryptionKeys,
  hmacKeys: environment.authentication.appAccountTokenHmacKeys,
};
const application = new IapApplicationService({
  client: prisma,
  resolveTokenOwner: async (transaction, rawToken) =>
    findBindingByToken(transaction, rawToken, tokenKeys.hmacKeys),
});
const draws = new FortuneDrawService({ client: prisma });
const state = new FortuneStateService(prisma);
const viewed = new FortuneViewedService(prisma);

let transactionCounter = 8_000_000_000_000;

afterAll(async () => {
  await prisma.$disconnect();
});

interface MonetizedFixture {
  authentication: AuthenticationContext;
  financialSubjectId: string;
  userId: string;
}

/**
 * Both benefits are created the way production creates them: a verified Apple
 * transaction applied through the shared application service. Nothing in this
 * test hand-writes a ledger row or an entitlement.
 */
async function applyPurchase(
  purchaseToken: string,
  product: 'PACK' | 'SUBSCRIPTION',
  now: Date,
): Promise<void> {
  transactionCounter += 1;
  const transactionId = String(transactionCounter);
  const subscription = product === 'SUBSCRIPTION';
  const verified: VerifiedAppleTransaction = {
    appAccountToken: purchaseToken,
    billingPlanType: subscription ? 'MONTHLY' : null,
    environment: 'SANDBOX',
    expiresAt: subscription ? new Date(now.getTime() + 30 * 86_400_000) : null,
    jwsHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    normalizedPayload: { bundleId: 'app.fortuneness.test' },
    originalTransactionId: transactionId,
    productId: subscription
      ? 'app.fortuneness.oracleplus.monthly'
      : 'app.fortuneness.fortunepack10',
    productType: subscription ? 'AUTO_RENEWABLE_SUBSCRIPTION' : 'CONSUMABLE',
    purchaseAt: now,
    revocationAt: null,
    revocationPercentage: null,
    revocationReason: null,
    signedAt: now,
    transactionId,
  };
  const outcome = await application.apply(verified, {
    authorityRank: 0,
    sourceAt: now,
    sourceId: `client:${transactionId}`,
  });
  if (!outcome.appliedNow) {
    throw new Error('The fixture purchase was not applied.');
  }
}

async function createFixture(options: {
  packs: number;
  subscription: boolean;
}): Promise<MonetizedFixture> {
  const now = new Date();
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const user = await prisma.user.create({
    data: { accountTimeZone: 'UTC', activeFinancialSubjectId: financialSubject.id },
  });
  const authTimeSeconds = Math.floor(now.getTime() / 1_000);
  const family = await prisma.sessionFamily.create({
    data: {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      identityAuthenticatedAt: new Date(authTimeSeconds * 1_000),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    },
  });
  const purchaseToken = await runReadCommittedTransaction(prisma, (transaction) =>
    resolveCurrentPurchaseToken(transaction, financialSubject.id, tokenKeys, now),
  );

  if (options.subscription) {
    await applyPurchase(purchaseToken.token, 'SUBSCRIPTION', now);
  }
  for (let pack = 0; pack < options.packs; pack += 1) {
    await applyPurchase(purchaseToken.token, 'PACK', now);
  }

  return {
    financialSubjectId: financialSubject.id,
    userId: user.id,
    authentication: {
      userId: user.id,
      sessionFamilyId: family.id,
      sessionVersion: user.sessionVersion,
      authTimeSeconds,
      authTime: new Date(authTimeSeconds * 1_000),
    },
  };
}

/** Draws once and acknowledges it, so the next draw is not blocked. */
async function drawAndAcknowledge(fixture: MonetizedFixture): Promise<AllowanceSource> {
  const result = await draws.draw(fixture.authentication, { intention: 'GENERAL' }, randomUUID());
  await viewed.markViewed(fixture.authentication, result.response.draw.id);
  return result.response.draw.allowanceSource;
}

async function packBalance(financialSubjectId: string): Promise<number> {
  const aggregate = await prisma.creditLedgerEntry.aggregate({
    where: { financialSubjectId },
    _sum: { delta: true },
  });
  return aggregate._sum.delta ?? 0;
}

describe('monetized allowance ordering', () => {
  it('spends the eleventh subscriber draw from the subscription, not from pack credits', async () => {
    const fixture = await createFixture({ packs: 1, subscription: true });
    const sources: AllowanceSource[] = [];

    for (let draw = 0; draw < 11; draw += 1) {
      sources.push(await drawAndAcknowledge(fixture));
    }

    expect(sources).toEqual([
      'FREE_DAILY',
      ...Array.from({ length: 10 }, () => 'SUBSCRIPTION_DAILY' as const),
    ]);
    expect(await packBalance(fixture.financialSubjectId)).toBe(10);

    const afterEleven = await state.get(fixture.authentication);
    expect(afterEleven.state).toMatchObject({
      availableDraws: 10,
      freeRemaining: 0,
      spendablePackCredits: 10,
      subscriptionRemaining: 0,
    });

    // Only the twelfth draw of the day may reach a purchased credit.
    expect(await drawAndAcknowledge(fixture)).toBe('PACK_CREDIT');
    expect(await packBalance(fixture.financialSubjectId)).toBe(9);
  });

  it('keeps the free daily reading and the collection when a subscription expires', async () => {
    const fixture = await createFixture({ packs: 0, subscription: true });
    const firstSource = await drawAndAcknowledge(fixture);
    expect(firstSource).toBe('FREE_DAILY');

    await prisma.subscriptionEntitlement.updateMany({
      where: { financialSubjectId: fixture.financialSubjectId },
      data: { status: 'EXPIRED', paidThrough: new Date(Date.now() - 86_400_000) },
    });

    const expired = await state.get(fixture.authentication);
    expect(expired.state).toMatchObject({
      availableDraws: 0,
      freeRemaining: 0,
      spendablePackCredits: 0,
      subscriptionRemaining: 0,
      subscription: { entitled: false, status: 'EXPIRED' },
    });
    // The reading already collected under the subscription is untouched.
    expect(await prisma.fortuneDraw.count({ where: { userId: fixture.userId } })).toBe(1);

    // Move the spent period a whole account day into the past so the next
    // state read opens a new one, exactly as the daily reset does.
    const spentPeriods = await prisma.allowancePeriod.findMany({
      where: { userId: fixture.userId },
    });
    for (const period of spentPeriods) {
      await prisma.allowancePeriod.update({
        where: { userId_id: { userId: fixture.userId, id: period.id } },
        data: {
          startedAt: new Date(period.startedAt.getTime() - 86_400_000),
          resetAt: new Date(period.resetAt.getTime() - 86_400_000),
        },
      });
    }
    const nextDay = await state.get(fixture.authentication);
    expect(nextDay.state).toMatchObject({
      availableDraws: 1,
      freeRemaining: 1,
      subscriptionRemaining: 0,
    });
    expect(await drawAndAcknowledge(fixture)).toBe('FREE_DAILY');
  });

  it('spends pack credits for a non-subscriber only after the free reading', async () => {
    const fixture = await createFixture({ packs: 1, subscription: false });

    expect(await drawAndAcknowledge(fixture)).toBe('FREE_DAILY');
    expect(await packBalance(fixture.financialSubjectId)).toBe(10);
    expect(await drawAndAcknowledge(fixture)).toBe('PACK_CREDIT');
    expect(await packBalance(fixture.financialSubjectId)).toBe(9);

    const remaining = await state.get(fixture.authentication);
    expect(remaining.state).toMatchObject({ availableDraws: 9, spendablePackCredits: 9 });
  });
});
