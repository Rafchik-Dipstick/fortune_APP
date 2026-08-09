import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';

import { AccountPurgeWorker } from '../account/purge.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  AppleIdentityNotificationService,
  type AppleIdentityNotificationVerifier,
  type VerifiedAppleIdentityNotification,
} from './apple-identity-notification.js';
import { createAppleIdentityDigests } from './apple-identity-token.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const environment = createTestApiEnvironment().authentication;
const now = new Date('2026-08-09T12:00:00.000Z');

afterAll(async () => {
  await prisma.$disconnect();
});

function sha256Fixture(): string {
  return randomUUID().replaceAll('-', '').padEnd(64, '0');
}

function verified(
  type: 'account-deleted' | 'consent-revoked',
  subject: string,
): VerifiedAppleIdentityNotification {
  return {
    eventAt: now,
    identityCandidates: createAppleIdentityDigests(subject, environment).identityCandidates,
    notificationId: randomUUID(),
    requestHash: sha256Fixture(),
    type,
  };
}

class FakeVerifier implements AppleIdentityNotificationVerifier {
  constructor(private readonly notification: VerifiedAppleIdentityNotification) {}

  verify(): Promise<VerifiedAppleIdentityNotification> {
    return Promise.resolve(this.notification);
  }
}

async function createUser(subject: string): Promise<{
  familyId: string;
  userId: string;
}> {
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const user = await prisma.user.create({
    data: {
      accountTimeZone: 'UTC',
      activeFinancialSubjectId: financialSubject.id,
    },
  });
  const identity = createAppleIdentityDigests(subject, environment).currentIdentity;
  await prisma.externalIdentity.create({
    data: {
      provider: 'SIGN_IN_WITH_APPLE',
      userId: user.id,
      keyVersion: identity.keyVersion,
      subjectDigest: identity.digest,
      lastAuthenticatedAt: now,
    },
  });
  const family = await prisma.sessionFamily.create({
    data: {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      identityAuthenticatedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    },
  });
  return { familyId: family.id, userId: user.id };
}

describe('Sign in with Apple account notifications', () => {
  it('revokes every session exactly once when Apple reports consent revocation', async () => {
    const subject = `consent-${randomUUID()}`;
    const fixture = await createUser(subject);
    const notification = verified('consent-revoked', subject);
    const service = new AppleIdentityNotificationService(
      prisma,
      new FakeVerifier(notification),
      () => now,
    );

    await service.ingest('signed-payload');
    await service.ingest('signed-payload');

    const [user, family, idempotency, audits] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      prisma.sessionFamily.findUniqueOrThrow({ where: { id: fixture.familyId } }),
      prisma.idempotencyRecord.findMany({ where: { key: notification.notificationId } }),
      prisma.auditEvent.findMany({ where: { actorId: notification.notificationId } }),
    ]);
    expect(user.sessionVersion).toBe(2);
    expect(family).toMatchObject({
      revokedAt: now,
      revocationReason: 'APPLE_CONSENT_REVOKED',
    });
    expect(idempotency).toHaveLength(1);
    expect(idempotency[0]?.outcomeStatus).toBe('COMPLETED');
    expect(audits).toHaveLength(1);
  });

  it('queues and completes immediate purge when Apple reports account deletion', async () => {
    const subject = `deleted-${randomUUID()}`;
    const fixture = await createUser(subject);
    const notification = verified('account-deleted', subject);
    const service = new AppleIdentityNotificationService(
      prisma,
      new FakeVerifier(notification),
      () => now,
    );

    await service.ingest('signed-account-deletion');
    const pending = await prisma.accountDeletionRequest.findFirstOrThrow({
      where: { userId: fixture.userId, status: 'PENDING' },
    });
    expect(pending.purgeAt).toEqual(new Date(now.getTime() + 1));
    expect(await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).toMatchObject({
      status: 'DELETION_PENDING',
      sessionVersion: 2,
    });

    const worker = new AccountPurgeWorker({
      client: prisma,
      now: () => new Date(now.getTime() + 1_000),
      workerId: `test-${randomUUID()}`,
    });
    const result = await worker.run();
    expect(result.purgedUserIds).toContain(fixture.userId);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).toMatchObject({
      status: 'PURGED',
      activeFinancialSubjectId: null,
    });
    expect(await prisma.externalIdentity.count({ where: { userId: fixture.userId } })).toBe(0);
  });
});
