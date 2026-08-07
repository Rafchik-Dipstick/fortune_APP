import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { FortuneDrawService } from '../fortune/draw.js';
import { FortuneViewedService } from '../fortune/viewed.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { IapApplicationService } from '../iap/application.js';
import { findBindingByToken, resolveCurrentPurchaseToken } from '../iap/purchase-token.js';
import { type VerifiedAppleTransaction } from '../iap/verification.js';
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

const draws = new FortuneDrawService({ client: prisma });
const viewed = new FortuneViewedService(prisma);
const application = new IapApplicationService({
  client: prisma,
  resolveTokenOwner: async (transaction, rawToken) =>
    findBindingByToken(transaction, rawToken, tokenKeys.hmacKeys),
});
let transactionCounter = 9_100_000_000_000;

interface DeletionFixture {
  authentication: AuthenticationContext;
  financialSubjectId: string;
  purchaseToken: string;
  userId: string;
}

/** Grants ten pack credits the way production does: a verified transaction. */
async function applyPack(purchaseToken: string, now: Date): Promise<void> {
  transactionCounter += 1;
  const transactionId = String(transactionCounter);
  const verified: VerifiedAppleTransaction = {
    appAccountToken: purchaseToken,
    billingPlanType: null,
    environment: 'SANDBOX',
    expiresAt: null,
    jwsHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    normalizedPayload: { bundleId: 'app.fortuneness.test' },
    originalTransactionId: transactionId,
    productId: 'app.fortuneness.fortunepack10',
    productType: 'CONSUMABLE',
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
  const purchaseToken = await runReadCommittedTransaction(prisma, (transaction) =>
    resolveCurrentPurchaseToken(transaction, financialSubject.id, tokenKeys, now),
  );

  return {
    financialSubjectId: financialSubject.id,
    purchaseToken: purchaseToken.token,
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

  it('completes for an account still holding and having spent pack credit', async () => {
    const fixture = await createFixture();
    await applyPack(fixture.purchaseToken, new Date());
    // Spend the free daily reading first so the next one costs a pack credit,
    // which is what writes a FORTUNE_DRAW ledger row pointing at a draw.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const drawn = await draws.draw(
        fixture.authentication,
        { intention: 'GENERAL' },
        randomUUID(),
      );
      await viewed.markViewed(fixture.authentication, drawn.response.draw.id);
    }
    const spent = await prisma.creditLedgerEntry.findFirstOrThrow({
      where: { financialSubjectId: fixture.financialSubjectId, reason: 'FORTUNE_DRAW' },
    });
    expect(spent.drawId).not.toBeNull();

    await deletion.request(fixture.authentication, confirmations);
    const worker = new AccountPurgeWorker({
      client: prisma,
      now: () => new Date(Date.now() + 31 * 86_400_000),
      workerId: 'test-purge-with-credit',
    });
    const result = await worker.run();

    // Two database guards used to make this impossible: the cutoff trigger
    // refuses to close a subject holding credit, and the append-only trigger
    // refuses the `SET NULL` that deleting a draw performs on its ledger row.
    expect(result.failed).toBe(0);
    expect(result.purgedUserIds).toContain(fixture.userId);
    expect(await prisma.fortuneDraw.count({ where: { userId: fixture.userId } })).toBe(0);

    const subject = await prisma.financialSubject.findUniqueOrThrow({
      where: { id: fixture.financialSubjectId },
    });
    expect(subject.benefitsDisabledAt).not.toBeNull();

    // The forfeited credit is written off, never edited away: the ledger still
    // shows the purchase, the spend, and the write-off that zeroed it.
    const balance = await prisma.creditLedgerEntry.aggregate({
      where: { financialSubjectId: fixture.financialSubjectId },
      _sum: { delta: true },
    });
    expect(balance._sum.delta).toBe(0);
    const writeOff = await prisma.creditLedgerEntry.findUniqueOrThrow({
      where: { effectKey: `purge:${fixture.financialSubjectId}` },
    });
    expect(writeOff.reason).toBe('SUPPORT_ADJUSTMENT');
    expect(writeOff.balanceAfter).toBe(0);
    await expect(
      prisma.creditLedgerEntry.findUniqueOrThrow({ where: { id: spent.id } }),
    ).resolves.toMatchObject({ delta: -1, drawId: null, reason: 'FORTUNE_DRAW' });
  });

  it('lets the batch survive one request it cannot purge', async () => {
    const first = await createFixture();
    const second = await createFixture();
    await deletion.request(first.authentication, confirmations);
    await deletion.request(second.authentication, confirmations);

    // Only `purge` opens a transaction, so failing the first `$transaction`
    // poisons exactly one request and leaves the rest of the batch untouched.
    let poisonNext = true;
    const failures: string[] = [];
    const flakyClient = new Proxy(prisma, {
      get(target, property, receiver): unknown {
        if (property !== '$transaction') {
          return Reflect.get(target, property, receiver) as unknown;
        }
        return (...args: unknown[]): unknown => {
          if (poisonNext) {
            poisonNext = false;
            return Promise.reject(new Error('poisoned request'));
          }
          return (Reflect.get(target, property, receiver) as (...rest: unknown[]) => unknown).apply(
            target,
            args,
          );
        };
      },
    });

    const worker = new AccountPurgeWorker({
      client: flakyClient,
      now: () => new Date(Date.now() + 31 * 86_400_000),
      onFailure: (_error, context) => failures.push(context.userId),
      workerId: 'test-purge-isolation',
    });
    const result = await worker.run();

    // The batch is ordered by `purgeAt`, so before per-request isolation the
    // poisoned row at the head starved every deletion queued behind it.
    expect(result.failed).toBe(1);
    expect(failures).toHaveLength(1);
    const survivor = [first.userId, second.userId].find((userId) => !failures.includes(userId));
    if (survivor === undefined) {
      throw new Error('Exactly one request should have failed.');
    }
    expect(result.purgedUserIds).toContain(survivor);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: survivor } })).resolves.toMatchObject(
      { status: 'PURGED' },
    );
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
