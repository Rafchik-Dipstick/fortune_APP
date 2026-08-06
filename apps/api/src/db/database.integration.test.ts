import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../generated/prisma/client.js';
import { mapDatabaseError } from './errors.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createDrawFixture() {
  const now = new Date();
  const user = await prisma.user.create({ data: { accountTimeZone: 'UTC' } });
  const period = await prisma.allowancePeriod.create({
    data: {
      userId: user.id,
      sequence: 1n,
      startedAt: new Date(now.getTime() - 1_000),
      resetAt: new Date(now.getTime() + 86_400_000),
      timeZoneSnapshot: 'UTC',
    },
  });
  const template = await prisma.fortuneTemplate.findFirstOrThrow({
    where: { active: true },
    include: { card: true },
  });

  return {
    data: {
      userId: user.id,
      cardKey: template.cardKey,
      templateId: template.id,
      allowancePeriodId: period.id,
      allowanceSource: 'FREE_DAILY' as const,
      intention: template.intention,
      orientation: template.orientation,
      resolvedLocale: template.locale,
      sequence: 1n,
      cardDisplayNumber: template.card.displayNumber,
      cardNameSnapshot: template.card.nameEn,
      illustrationAltSnapshot: template.card.illustrationAltEn,
      headlineSnapshot: template.headline,
      messageSnapshot: template.message,
      gentleActionSnapshot: template.gentleAction,
      affirmationSnapshot: template.affirmation,
      contentVersionSnapshot: template.contentVersion,
      issuedAt: now,
      viewedAt: now,
      clientIdempotencyKey: randomUUID(),
      requestHash: 'a'.repeat(64),
    },
  };
}

async function createPurchaseFixture(transactionId = `tx-${randomUUID()}`) {
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const purchase = await prisma.iapTransaction.create({
    data: {
      environment: 'XCODE',
      transactionId,
      originalTransactionId: `original-${randomUUID()}`,
      productId: 'app.fortuneness.credits.10',
      productType: 'CONSUMABLE',
      financialSubjectId: financialSubject.id,
      purchaseAt: new Date(),
      normalizedPayload: { test: true },
      jwsHash: 'b'.repeat(64),
    },
  });
  return { financialSubject, purchase };
}

describe('PostgreSQL integrity', { concurrent: false }, () => {
  it('rejects a replayed verified Game Center proof fingerprint', async () => {
    const fingerprint = 'c'.repeat(64);
    await prisma.identityProofReplay.create({
      data: { fingerprint, expiresAt: new Date(Date.now() + 900_000) },
    });

    await expect(
      prisma.identityProofReplay.create({
        data: { fingerprint, expiresAt: new Date(Date.now() + 900_000) },
      }),
    ).rejects.toSatisfy((error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT');
  });

  it('rejects a duplicate user draw idempotency record', async () => {
    const fixture = await createDrawFixture();
    await prisma.fortuneDraw.create({ data: fixture.data });

    const duplicate = prisma.fortuneDraw.create({
      data: { ...fixture.data, sequence: 2n },
    });
    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT',
    );
  });

  it('rejects a duplicate environment-scoped Apple transaction', async () => {
    const transactionId = `tx-${randomUUID()}`;
    await createPurchaseFixture(transactionId);

    const duplicate = createPurchaseFixture(transactionId);
    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT',
    );
  });

  it('rejects duplicate ledger effects and mutation of committed ledger history', async () => {
    const { financialSubject, purchase } = await createPurchaseFixture();
    const grant = await prisma.packCreditGrant.create({
      data: {
        financialSubjectId: financialSubject.id,
        purchaseTransactionId: purchase.id,
      },
    });
    const effectKey = `purchase:${purchase.id}`;
    const ledgerEntry = await prisma.creditLedgerEntry.create({
      data: {
        financialSubjectId: financialSubject.id,
        delta: 10,
        balanceAfter: 10,
        reason: 'PACK_PURCHASE',
        grantId: grant.id,
        purchaseTransactionId: purchase.id,
        effectKey,
      },
    });

    const duplicate = prisma.creditLedgerEntry.create({
      data: {
        financialSubjectId: financialSubject.id,
        delta: 10,
        balanceAfter: 20,
        reason: 'PACK_PURCHASE',
        grantId: grant.id,
        purchaseTransactionId: purchase.id,
        effectKey,
      },
    });
    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT',
    );
    await expect(
      prisma.creditLedgerEntry.update({
        where: { id: ledgerEntry.id },
        data: { balanceAfter: 11 },
      }),
    ).rejects.toSatisfy((error: unknown) => mapDatabaseError(error)?.kind === 'CHECK_CONSTRAINT');
  });
});
