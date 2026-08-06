import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { IapApplicationError, IapApplicationService } from './application.js';
import { findBindingByToken, resolveCurrentPurchaseToken } from './purchase-token.js';
import { type VerifiedAppleTransaction } from './verification.js';

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

const service = new IapApplicationService({
  client: prisma,
  resolveTokenOwner: async (transaction, rawToken) =>
    findBindingByToken(transaction, rawToken, tokenKeys.hmacKeys),
});

const baseTime = new Date('2026-08-06T12:00:00.000Z');
let transactionCounter = 1000;

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSubjectWithToken(): Promise<{
  financialSubjectId: string;
  token: string;
}> {
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const token = await runReadCommittedTransaction(prisma, (transaction) =>
    resolveCurrentPurchaseToken(transaction, financialSubject.id, tokenKeys, baseTime),
  );
  return { financialSubjectId: financialSubject.id, token: token.token };
}

function packTransaction(
  token: string | null,
  overrides: Partial<VerifiedAppleTransaction> = {},
): VerifiedAppleTransaction {
  transactionCounter += 1;
  const transactionId = String(2_000_000_000_000 + transactionCounter);
  return {
    appAccountToken: token,
    billingPlanType: null,
    environment: 'SANDBOX',
    expiresAt: null,
    jwsHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    normalizedPayload: { bundleId: 'app.fortuneness.test' },
    originalTransactionId: transactionId,
    productId: 'app.fortuneness.fortunepack10',
    productType: 'CONSUMABLE',
    purchaseAt: baseTime,
    revocationAt: null,
    revocationPercentage: null,
    revocationReason: null,
    signedAt: baseTime,
    transactionId,
    ...overrides,
  };
}

function subscriptionTransaction(
  token: string | null,
  overrides: Partial<VerifiedAppleTransaction> = {},
): VerifiedAppleTransaction {
  transactionCounter += 1;
  const transactionId = String(3_000_000_000_000 + transactionCounter);
  return {
    ...packTransaction(token, {
      transactionId,
      originalTransactionId: transactionId,
      productId: 'app.fortuneness.oracleplus.monthly',
      productType: 'AUTO_RENEWABLE_SUBSCRIPTION',
      billingPlanType: 'MONTHLY',
      expiresAt: new Date(baseTime.getTime() + 30 * 86_400_000),
    }),
    ...overrides,
  };
}

async function spendableBalance(financialSubjectId: string): Promise<number> {
  const aggregate = await prisma.creditLedgerEntry.aggregate({
    where: { financialSubjectId },
    _sum: { delta: true },
  });
  return aggregate._sum.delta ?? 0;
}

describe('IapApplicationService pack purchases', () => {
  it('applies a verified pack exactly once across duplicate deliveries', async () => {
    const subject = await createSubjectWithToken();
    const verified = packTransaction(subject.token);

    const first = await service.apply(verified, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${verified.transactionId}`,
    });
    expect(first.appliedNow).toBe(true);
    expect(first.ownerFinancialSubjectId).toBe(subject.financialSubjectId);

    const second = await service.apply(verified, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${verified.transactionId}`,
    });
    expect(second.appliedNow).toBe(false);

    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);
    const grants = await prisma.packCreditGrant.findMany({
      where: { financialSubjectId: subject.financialSubjectId },
    });
    expect(grants).toHaveLength(1);
  });

  it('converges refund-before-delivery to zero units, then reversal restores them', async () => {
    const subject = await createSubjectWithToken();
    const revokedAt = new Date(baseTime.getTime() + 3_600_000);
    const refunded = packTransaction(subject.token, {
      revocationAt: revokedAt,
      revocationPercentage: 100_000,
      revocationReason: '0',
    });

    const applied = await service.apply(refunded, {
      authorityRank: 0,
      refundEventType: 'REFUND',
      sourceAt: revokedAt,
      sourceId: `notification:refund-${refunded.transactionId}`,
    });
    expect(applied.appliedNow).toBe(true);
    expect(await spendableBalance(subject.financialSubjectId)).toBe(0);

    const reversal = await service.apply(
      { ...refunded, revocationAt: null, revocationPercentage: null, revocationReason: null },
      {
        authorityRank: 0,
        refundEventType: 'REFUND_REVERSED',
        sourceAt: new Date(revokedAt.getTime() + 3_600_000),
        sourceId: `notification:reversal-${refunded.transactionId}`,
      },
    );
    expect(reversal.appliedNow).toBe(true);
    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);

    // A stale refund arriving after the newer reversal changes nothing.
    const stale = await service.apply(refunded, {
      authorityRank: 0,
      refundEventType: 'REFUND',
      sourceAt: revokedAt,
      sourceId: `notification:refund-${refunded.transactionId}`,
    });
    expect(stale.appliedNow).toBe(false);
    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);
  });

  it('grants a later independent pack its full ten units after an earlier refund', async () => {
    const subject = await createSubjectWithToken();
    const first = packTransaction(subject.token, {
      revocationAt: new Date(baseTime.getTime() + 1_000),
      revocationPercentage: 100_000,
      revocationReason: '0',
    });
    await service.apply(first, {
      authorityRank: 0,
      refundEventType: 'REFUND',
      sourceAt: new Date(baseTime.getTime() + 1_000),
      sourceId: `notification:refund-${first.transactionId}`,
    });

    const second = packTransaction(subject.token);
    await service.apply(second, {
      authorityRank: 0,
      sourceAt: new Date(baseTime.getTime() + 2_000),
      sourceId: `client:${second.transactionId}`,
    });

    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);
  });

  it('quarantines a transaction with no business key and no known token', async () => {
    const verified = packTransaction(randomUUID());
    await expect(
      service.apply(verified, {
        authorityRank: 0,
        sourceAt: baseTime,
        sourceId: `client:${verified.transactionId}`,
      }),
    ).rejects.toMatchObject({ code: 'TRANSACTION_OWNER_UNKNOWN' });

    const row = await prisma.iapTransaction.findUnique({
      where: {
        environment_transactionId: {
          environment: 'SANDBOX',
          transactionId: verified.transactionId,
        },
      },
    });
    expect(row).toBeNull();
  });

  it('accepts a nil-token duplicate for the recorded owner', async () => {
    const subject = await createSubjectWithToken();
    const verified = packTransaction(subject.token);
    await service.apply(verified, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${verified.transactionId}`,
    });

    const nilTokenDuplicate = await service.apply(
      { ...verified, appAccountToken: null },
      {
        authorityRank: 0,
        sourceAt: baseTime,
        sourceId: `notification:${verified.transactionId}`,
      },
    );
    expect(nilTokenDuplicate.appliedNow).toBe(false);
    expect(nilTokenDuplicate.ownerFinancialSubjectId).toBe(subject.financialSubjectId);
  });

  it('fails closed when a nonnil token conflicts with recorded ownership', async () => {
    const owner = await createSubjectWithToken();
    const other = await createSubjectWithToken();
    const verified = packTransaction(owner.token);
    await service.apply(verified, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${verified.transactionId}`,
    });

    await expect(
      service.apply(
        { ...verified, appAccountToken: other.token },
        {
          authorityRank: 0,
          sourceAt: baseTime,
          sourceId: `client:${verified.transactionId}`,
        },
      ),
    ).rejects.toMatchObject({ code: 'TRANSACTION_OWNER_UNKNOWN' });

    expect(await spendableBalance(other.financialSubjectId)).toBe(0);
  });

  it('records a terminal no-benefit disposition for a closed owner', async () => {
    const subject = await createSubjectWithToken();
    await prisma.financialSubject.update({
      where: { id: subject.financialSubjectId },
      data: { benefitsDisabledAt: baseTime },
    });

    const verified = packTransaction(subject.token);
    const outcome = await service.apply(verified, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${verified.transactionId}`,
    });

    expect(outcome.ownerClosed).toBe(true);
    expect(outcome.appliedNow).toBe(false);
    expect(await spendableBalance(subject.financialSubjectId)).toBe(0);
    const row = await prisma.iapTransaction.findUniqueOrThrow({
      where: {
        environment_transactionId: {
          environment: 'SANDBOX',
          transactionId: verified.transactionId,
        },
      },
    });
    expect(row.disposition).toBe('OWNER_CLOSED_NO_BENEFIT');
  });

  it('applies the same verified transaction exactly once under a concurrent race', async () => {
    const subject = await createSubjectWithToken();
    const verified = packTransaction(subject.token);
    const context = {
      authorityRank: 0 as const,
      sourceAt: baseTime,
      sourceId: `client:${verified.transactionId}`,
    };

    const outcomes = await Promise.all([
      service.apply(verified, context),
      service.apply(verified, context),
      service.apply(verified, context),
    ]);

    expect(outcomes.filter((outcome) => outcome.appliedNow)).toHaveLength(1);
    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);
  });
});

describe('IapApplicationService subscriptions', () => {
  it('derives an active entitlement and keeps monotonic paid-through', async () => {
    const subject = await createSubjectWithToken();
    const initial = subscriptionTransaction(subject.token);
    await service.apply(initial, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${initial.transactionId}`,
    });

    const entitlement = await prisma.subscriptionEntitlement.findUniqueOrThrow({
      where: {
        environment_originalTransactionId: {
          environment: 'SANDBOX',
          originalTransactionId: initial.originalTransactionId,
        },
      },
    });
    expect(entitlement.status).toBe('ACTIVE');
    expect(entitlement.paidThrough?.getTime()).toBe(initial.expiresAt?.getTime());

    // A renewal with a later expiration extends the aggregate.
    const renewal = subscriptionTransaction(null, {
      originalTransactionId: initial.originalTransactionId,
      expiresAt: new Date(baseTime.getTime() + 60 * 86_400_000),
      purchaseAt: new Date(baseTime.getTime() + 30 * 86_400_000),
    });
    await service.apply(renewal, {
      authorityRank: 0,
      sourceAt: new Date(baseTime.getTime() + 30 * 86_400_000),
      sourceId: `notification:${renewal.transactionId}`,
    });

    const extended = await prisma.subscriptionEntitlement.findUniqueOrThrow({
      where: {
        environment_originalTransactionId: {
          environment: 'SANDBOX',
          originalTransactionId: initial.originalTransactionId,
        },
      },
    });
    expect(extended.paidThrough?.getTime()).toBe(renewal.expiresAt?.getTime());

    // An out-of-order older renewal fact cannot erase the newer grace state.
    await service.apply(renewal, {
      authorityRank: 0,
      renewalFact: {
        autoRenewEnabled: false,
        billingRetry: true,
        graceThrough: new Date(baseTime.getTime() + 76 * 86_400_000),
      },
      sourceAt: new Date(baseTime.getTime() + 61 * 86_400_000),
      sourceId: `notification:grace-${renewal.transactionId}`,
    });
    await service.apply(renewal, {
      authorityRank: 0,
      renewalFact: { autoRenewEnabled: true, billingRetry: false, graceThrough: null },
      sourceAt: new Date(baseTime.getTime() + 60 * 86_400_000),
      sourceId: `notification:stale-${renewal.transactionId}`,
    });

    const graced = await prisma.subscriptionEntitlement.findUniqueOrThrow({
      where: {
        environment_originalTransactionId: {
          environment: 'SANDBOX',
          originalTransactionId: initial.originalTransactionId,
        },
      },
    });
    expect(graced.graceThrough?.getTime()).toBe(baseTime.getTime() + 76 * 86_400_000);
    expect(graced.billingRetry).toBe(true);
    expect(graced.autoRenewEnabled).toBe(false);
  });

  it('revokes on refund and restores on a newer reversal without pack-unit logic', async () => {
    const subject = await createSubjectWithToken();
    const initial = subscriptionTransaction(subject.token);
    await service.apply(initial, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${initial.transactionId}`,
    });

    const revokedAt = new Date(baseTime.getTime() + 86_400_000);
    await service.apply(
      { ...initial, revocationAt: revokedAt, revocationReason: '0' },
      {
        authorityRank: 0,
        refundEventType: 'REFUND',
        sourceAt: revokedAt,
        sourceId: `notification:refund-${initial.transactionId}`,
      },
    );

    const revoked = await prisma.subscriptionEntitlement.findUniqueOrThrow({
      where: {
        environment_originalTransactionId: {
          environment: 'SANDBOX',
          originalTransactionId: initial.originalTransactionId,
        },
      },
    });
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.paidThrough).toBeNull();
    // Subscription refunds never touch the pack ledger.
    expect(await spendableBalance(subject.financialSubjectId)).toBe(0);

    await service.apply(initial, {
      authorityRank: 0,
      refundEventType: 'REFUND_REVERSED',
      sourceAt: new Date(revokedAt.getTime() + 3_600_000),
      sourceId: `notification:reversal-${initial.transactionId}`,
    });

    const restored = await prisma.subscriptionEntitlement.findUniqueOrThrow({
      where: {
        environment_originalTransactionId: {
          environment: 'SANDBOX',
          originalTransactionId: initial.originalTransactionId,
        },
      },
    });
    expect(restored.status).toBe('ACTIVE');
    expect(restored.paidThrough?.getTime()).toBe(initial.expiresAt?.getTime());
  });

  it('routes a nil-token renewal to the recorded original-transaction owner', async () => {
    const subject = await createSubjectWithToken();
    const initial = subscriptionTransaction(subject.token);
    await service.apply(initial, {
      authorityRank: 0,
      sourceAt: baseTime,
      sourceId: `client:${initial.transactionId}`,
    });

    const renewal = subscriptionTransaction(null, {
      originalTransactionId: initial.originalTransactionId,
      expiresAt: new Date(baseTime.getTime() + 60 * 86_400_000),
    });
    const outcome = await service.apply(renewal, {
      authorityRank: 0,
      sourceAt: new Date(baseTime.getTime() + 30 * 86_400_000),
      sourceId: `notification:${renewal.transactionId}`,
    });

    expect(outcome.ownerFinancialSubjectId).toBe(subject.financialSubjectId);
    expect(outcome.appliedNow).toBe(true);
  });
});

describe('IapApplicationError', () => {
  it('is a typed error with a stable code', () => {
    const error = new IapApplicationError('RETRYABLE_CONFLICT', 'retry');
    expect(error.code).toBe('RETRYABLE_CONFLICT');
  });
});
