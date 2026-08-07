import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { resolveCurrentPurchaseToken } from '../iap/purchase-token.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { AccountDeletionError, AccountDeletionService } from './deletion.js';
import { AccountPurgeWorker } from './purge.js';

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

afterAll(async () => {
  await prisma.$disconnect();
});

const confirmations = {
  confirmationVersion: '2026-08-delete-v1',
  acknowledgedAccessEnds: true,
  acknowledgedDataLoss: true,
} as const;

interface DeletionFixture {
  authentication: AuthenticationContext;
  financialSubjectId: string;
  userId: string;
}

/** Builds an account whose Game Center proof is `proofAgeSeconds` old. */
async function createFixture(proofAgeSeconds = 10): Promise<DeletionFixture> {
  const now = new Date();
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const user = await prisma.user.create({
    data: { accountTimeZone: 'UTC', activeFinancialSubjectId: financialSubject.id },
  });
  const authenticatedAt = new Date(now.getTime() - proofAgeSeconds * 1_000);
  const authTimeSeconds = Math.floor(authenticatedAt.getTime() / 1_000);
  const family = await prisma.sessionFamily.create({
    data: {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      gameCenterAuthenticatedAt: new Date(authTimeSeconds * 1_000),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      refreshTokens: {
        create: {
          tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        },
      },
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider: 'GAME_CENTER',
      userId: user.id,
      keyVersion: 'v1',
      subjectDigest: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      lastAuthenticatedAt: now,
    },
  });
  await runReadCommittedTransaction(prisma, (transaction) =>
    resolveCurrentPurchaseToken(transaction, financialSubject.id, tokenKeys, now),
  );

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

const deletion = new AccountDeletionService({ client: prisma });

describe('account deletion', () => {
  it('revokes every session the moment the request commits', async () => {
    const fixture = await createFixture();

    const response = await deletion.request(fixture.authentication, confirmations);

    expect(response.deletion.status).toBe('PENDING');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('DELETION_PENDING');
    expect(user.sessionVersion).toBe(fixture.authentication.sessionVersion + 1);
    const active = await prisma.sessionFamily.count({
      where: { userId: fixture.userId, revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it('refuses a proof older than the three hundred second gate', async () => {
    const fixture = await createFixture(301);

    await expect(deletion.request(fixture.authentication, confirmations)).rejects.toMatchObject({
      code: 'GAME_CENTER_REAUTH_REQUIRED',
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('ACTIVE');
  });

  it('requires the Apple billing acknowledgement only when billing may continue', async () => {
    const fixture = await createFixture();
    await prisma.subscriptionEntitlement.create({
      data: {
        environment: 'SANDBOX',
        originalTransactionId: `del-${randomUUID().slice(0, 12)}`,
        financialSubjectId: fixture.financialSubjectId,
        productId: 'app.fortuneness.oracleplus.monthly',
        status: 'ACTIVE',
        paidThrough: new Date(Date.now() + 20 * 86_400_000),
        lastAppleEventTime: new Date(),
        lastAppleSourceId: `fixture-${randomUUID()}`,
      },
    });

    await expect(deletion.request(fixture.authentication, confirmations)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // Deletion is never disabled by an active subscription; it only requires
    // the extra acknowledgement.
    const accepted = await deletion.request(fixture.authentication, {
      ...confirmations,
      acknowledgedAppleBilling: true,
    });
    expect(accepted.deletion.status).toBe('PENDING');
  });

  it('keeps a second concurrent request singular', async () => {
    const fixture = await createFixture();
    await deletion.request(fixture.authentication, confirmations);

    await expect(deletion.request(fixture.authentication, confirmations)).rejects.toBeInstanceOf(
      AccountDeletionError,
    );
    expect(await prisma.accountDeletionRequest.count({ where: { userId: fixture.userId } })).toBe(
      1,
    );
  });

  it('restores the account when cancellation wins before purge', async () => {
    const fixture = await createFixture();
    await deletion.request(fixture.authentication, confirmations);

    await deletion.cancel(fixture.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('ACTIVE');
    const request = await prisma.accountDeletionRequest.findFirstOrThrow({
      where: { userId: fixture.userId },
    });
    expect(request.status).toBe('CANCELLED');
    expect(request.cancelledAt).not.toBeNull();

    // A purge run must now find nothing to do for this account.
    const worker = new AccountPurgeWorker({
      client: prisma,
      now: () => new Date(Date.now() + 40 * 86_400_000),
      workerId: 'test-after-cancel',
    });
    const result = await worker.run();
    expect(result.purgedUserIds).not.toContain(fixture.userId);
  });
});

describe('account purge', () => {
  it('cuts off benefits, erases the raw token, and removes personal data', async () => {
    const fixture = await createFixture();
    await deletion.request(fixture.authentication, confirmations);
    const afterPurgeDate = new Date(Date.now() + 31 * 86_400_000);

    const worker = new AccountPurgeWorker({
      client: prisma,
      now: () => afterPurgeDate,
      workerId: 'test-purge',
    });
    const result = await worker.run();
    expect(result.purgedUserIds).toContain(fixture.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('PURGED');
    expect(user.activeFinancialSubjectId).toBeNull();

    // The financial subject survives with an irreversible benefit cutoff, so
    // late Apple events can still be recorded and grant nothing.
    const subject = await prisma.financialSubject.findUniqueOrThrow({
      where: { id: fixture.financialSubjectId },
    });
    expect(subject.benefitsDisabledAt).not.toBeNull();

    const bindings = await prisma.appAccountTokenBinding.findMany({
      where: { financialSubjectId: fixture.financialSubjectId },
    });
    expect(bindings.length).toBeGreaterThan(0);
    for (const binding of bindings) {
      expect(binding.encryptedToken).toBeNull();
      expect(binding.cryptoErasedAt).not.toBeNull();
      // The digest remains where Apple routing still needs it.
      expect(binding.tokenDigest).toHaveLength(64);
    }

    expect(await prisma.externalIdentity.count({ where: { userId: fixture.userId } })).toBe(0);
    expect(await prisma.sessionFamily.count({ where: { userId: fixture.userId } })).toBe(0);
    expect(await prisma.fortuneDraw.count({ where: { userId: fixture.userId } })).toBe(0);
  });

  it('cannot be cancelled once the purge has completed', async () => {
    const fixture = await createFixture();
    await deletion.request(fixture.authentication, confirmations);
    const worker = new AccountPurgeWorker({
      client: prisma,
      now: () => new Date(Date.now() + 31 * 86_400_000),
      workerId: 'test-purge-terminal',
    });
    await worker.run();

    await expect(deletion.cancel(fixture.userId)).rejects.toMatchObject({
      code: 'ACCOUNT_PURGED',
    });
  });

  it('leaves a request alone until its purge date arrives', async () => {
    const fixture = await createFixture();
    await deletion.request(fixture.authentication, confirmations);

    const worker = new AccountPurgeWorker({ client: prisma, workerId: 'test-not-due' });
    const result = await worker.run();

    expect(result.purgedUserIds).not.toContain(fixture.userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('DELETION_PENDING');
  });
});
