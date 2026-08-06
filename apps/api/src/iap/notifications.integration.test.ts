import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { IapApplicationService } from './application.js';
import { ConsumptionService, type ConsumptionInformationSender } from './consumption.js';
import {
  AppStoreNotificationIngestService,
  AppStoreNotificationWorker,
} from './notifications.js';
import { findBindingByToken, resolveCurrentPurchaseToken } from './purchase-token.js';
import {
  type ResponseBodyV2DecodedPayload,
  type SignedNotificationVerifier,
  type SignedTransactionVerifier,
  type VerifiedAppleTransaction,
  type VerifiedRenewalInfo,
} from './verification.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const environment = createTestApiEnvironment();
const commerce = environment.commerce;
const tokenKeys = {
  encryptionKeys: environment.authentication.appAccountTokenEncryptionKeys,
  hmacKeys: environment.authentication.appAccountTokenHmacKeys,
};
const baseTime = new Date('2026-08-06T12:00:00.000Z');
let counter = 5000;

/**
 * Test double standing in for Apple's cryptographic verifier: payloads are
 * JSON envelopes carrying the exact decoded material a verified JWS would
 * produce. Signature checks themselves are covered by the Sandbox gate.
 */
class FakeVerifier implements SignedNotificationVerifier, SignedTransactionVerifier {
  async verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
    const parsed = JSON.parse(signedPayload) as {
      decoded: ResponseBodyV2DecodedPayload;
      fail?: boolean;
    };
    if (parsed.fail === true) {
      throw new Error('Fake verification failure');
    }
    return parsed.decoded;
  }

  async verifyTransaction(signedTransaction: string): Promise<VerifiedAppleTransaction> {
    const parsed = JSON.parse(signedTransaction) as Record<string, unknown>;
    for (const field of ['expiresAt', 'purchaseAt', 'revocationAt', 'signedAt']) {
      if (typeof parsed[field] === 'string') {
        parsed[field] = new Date(parsed[field]);
      }
    }
    return parsed as unknown as VerifiedAppleTransaction;
  }

  async verifyRenewalInfo(signedRenewalInfo: string): Promise<VerifiedRenewalInfo> {
    const parsed = JSON.parse(signedRenewalInfo) as Record<string, unknown>;
    if (typeof parsed['graceThrough'] === 'string') {
      parsed['graceThrough'] = new Date(parsed['graceThrough']);
    }
    return parsed as unknown as VerifiedRenewalInfo;
  }
}

const verifier = new FakeVerifier();
const application = new IapApplicationService({
  client: prisma,
  resolveTokenOwner: async (transaction, rawToken) =>
    findBindingByToken(transaction, rawToken, tokenKeys.hmacKeys),
});
const ingest = new AppStoreNotificationIngestService({ client: prisma, commerce, verifier });

function createWorker(sender?: ConsumptionInformationSender): AppStoreNotificationWorker {
  return new AppStoreNotificationWorker({
    application,
    client: prisma,
    commerce,
    consumption: new ConsumptionService({
      client: prisma,
      commerce,
      ...(sender === undefined ? {} : { sender }),
    }),
    verifier,
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSubjectWithToken(): Promise<{ financialSubjectId: string; token: string }> {
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
  counter += 1;
  const transactionId = String(4_000_000_000_000 + counter);
  return {
    appAccountToken: token,
    billingPlanType: null,
    environment: 'SANDBOX',
    expiresAt: null,
    jwsHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    normalizedPayload: {},
    originalTransactionId: transactionId,
    productId: commerce.fortunePack10ProductId,
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

function notificationEnvelope(
  notificationType: string,
  verified: VerifiedAppleTransaction | null,
  overrides: Partial<ResponseBodyV2DecodedPayload> = {},
): { signedPayload: string; uuid: string } {
  const uuid = randomUUID();
  const decoded: ResponseBodyV2DecodedPayload = {
    notificationType,
    notificationUUID: uuid,
    signedDate: baseTime.getTime(),
    ...(verified === null
      ? {}
      : { data: { signedTransactionInfo: JSON.stringify(verified) } }),
    ...overrides,
  } as ResponseBodyV2DecodedPayload;
  return { signedPayload: JSON.stringify({ decoded }), uuid };
}

async function spendableBalance(financialSubjectId: string): Promise<number> {
  const aggregate = await prisma.creditLedgerEntry.aggregate({
    where: { financialSubjectId },
    _sum: { delta: true },
  });
  return aggregate._sum.delta ?? 0;
}

describe('App Store notification pipeline', () => {
  it('persists the verified envelope durably and deduplicates transport by UUID', async () => {
    const subject = await createSubjectWithToken();
    const envelope = notificationEnvelope('ONE_TIME_CHARGE', packTransaction(subject.token));

    await ingest.ingest(envelope.signedPayload);
    await ingest.ingest(envelope.signedPayload);

    const rows = await prisma.appStoreNotification.findMany({
      where: { notificationUuid: envelope.uuid },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processingStatus).toBe('RECEIVED');
    expect(rows[0]?.encryptedPayload).not.toBeNull();
  });

  it('rejects an unverifiable envelope without storing it', async () => {
    await expect(
      ingest.ingest(JSON.stringify({ decoded: {}, fail: true })),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_UNVERIFIED' });
  });

  it('grants a pack from ONE_TIME_CHARGE even when the client never returns', async () => {
    const subject = await createSubjectWithToken();
    const envelope = notificationEnvelope('ONE_TIME_CHARGE', packTransaction(subject.token));
    await ingest.ingest(envelope.signedPayload);

    const processed = await createWorker().runOnce(50);
    expect(processed).toBeGreaterThan(0);

    const row = await prisma.appStoreNotification.findUniqueOrThrow({
      where: { notificationUuid: envelope.uuid },
    });
    expect(row.processingStatus).toBe('APPLIED');
    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);
  });

  it('converges distinct refund and reversal notifications for one event exactly once', async () => {
    const subject = await createSubjectWithToken();
    const purchase = packTransaction(subject.token);
    const purchaseEnvelope = notificationEnvelope('ONE_TIME_CHARGE', purchase);
    const refundEnvelope = notificationEnvelope('REFUND', {
      ...purchase,
      revocationAt: new Date(baseTime.getTime() + 3_600_000),
      revocationPercentage: 100_000,
      revocationReason: '0',
    });
    const reversalEnvelope = notificationEnvelope(
      'REFUND_REVERSED',
      purchase,
      { signedDate: baseTime.getTime() + 7_200_000 },
    );

    await ingest.ingest(purchaseEnvelope.signedPayload);
    await ingest.ingest(refundEnvelope.signedPayload);
    await ingest.ingest(reversalEnvelope.signedPayload);
    await createWorker().runOnce(50);

    expect(await spendableBalance(subject.financialSubjectId)).toBe(10);
    const grant = await prisma.packCreditGrant.findFirst({
      where: { financialSubjectId: subject.financialSubjectId },
    });
    expect(grant?.currentRefundTargetUnits).toBe(0);
    expect(grant?.disposition).toBe('ACTIVE');
  });

  it('quarantines an unowned notification terminally without granting', async () => {
    const envelope = notificationEnvelope('ONE_TIME_CHARGE', packTransaction(randomUUID()));
    await ingest.ingest(envelope.signedPayload);
    await createWorker().runOnce(50);

    const row = await prisma.appStoreNotification.findUniqueOrThrow({
      where: { notificationUuid: envelope.uuid },
    });
    expect(row.processingStatus).toBe('TERMINAL_FAILURE');
    expect(row.lastErrorCode).toBe('TRANSACTION_OWNER_UNKNOWN');
    expect(row.encryptedPayload).not.toBeNull();
  });

  it('retains unknown future types safely with their encrypted payload', async () => {
    const envelope = notificationEnvelope('SOME_FUTURE_TYPE', null);
    await ingest.ingest(envelope.signedPayload);
    await createWorker().runOnce(50);

    const row = await prisma.appStoreNotification.findUniqueOrThrow({
      where: { notificationUuid: envelope.uuid },
    });
    expect(row.processingStatus).toBe('UNKNOWN_RETAINED');
    expect(row.encryptedPayload).not.toBeNull();
  });

  it('acknowledges TEST notifications as applied', async () => {
    const envelope = notificationEnvelope('TEST', null);
    await ingest.ingest(envelope.signedPayload);
    await createWorker().runOnce(50);

    const row = await prisma.appStoreNotification.findUniqueOrThrow({
      where: { notificationUuid: envelope.uuid },
    });
    expect(row.processingStatus).toBe('APPLIED');
  });

  it('stores CONSUMPTION_REQUEST and sends nothing while consent is default off', async () => {
    const subject = await createSubjectWithToken();
    const purchase = packTransaction(subject.token);
    await ingest.ingest(notificationEnvelope('ONE_TIME_CHARGE', purchase).signedPayload);

    const sent: string[] = [];
    const worker = createWorker({
      send: async (transactionId) => {
        sent.push(transactionId);
      },
    });
    const envelope = notificationEnvelope('CONSUMPTION_REQUEST', purchase);
    await ingest.ingest(envelope.signedPayload);
    await worker.runOnce(50);

    const row = await prisma.appStoreNotification.findUniqueOrThrow({
      where: { notificationUuid: envelope.uuid },
    });
    expect(row.processingStatus).toBe('APPLIED');
    // Deployment flag and player consent both default off: nothing is sent.
    expect(sent).toHaveLength(0);
    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: 'iap.consumption_request.received',
        targetId: envelope.uuid,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('crypto-erases raw payloads past the bounded retention window', async () => {
    const envelope = notificationEnvelope('TEST', null);
    await ingest.ingest(envelope.signedPayload);
    await prisma.appStoreNotification.update({
      where: { notificationUuid: envelope.uuid },
      data: { payloadDeleteAt: new Date(baseTime.getTime() - 1_000) },
    });

    await createWorker().purgeExpiredPayloads();

    const row = await prisma.appStoreNotification.findUniqueOrThrow({
      where: { notificationUuid: envelope.uuid },
    });
    expect(row.encryptedPayload).toBeNull();
    expect(row.payloadHash).toHaveLength(64);
  });
});
