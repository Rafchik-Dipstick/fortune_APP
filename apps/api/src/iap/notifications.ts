import { createHash, randomUUID } from 'node:crypto';

import { type CommerceEnvironment } from '../config/environment.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import {
  type AppStoreNotificationProcessingStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { type ApiLogger } from '../logging/logger.js';
import { decryptBytes, encryptBytes } from '../security/crypto.js';
import { IapApplicationError, type IapApplicationService } from './application.js';
import { type ConsumptionRequestHandler } from './consumption.js';
import { type RefundEventType } from './pack-ledger.js';
import {
  SignedTransactionVerificationError,
  type SignedNotificationVerifier,
  type SignedTransactionVerifier,
} from './verification.js';

/** V2 notification types Fortuneness explicitly handles in V1. */
const handledNotificationTypes = new Set([
  'ONE_TIME_CHARGE',
  'SUBSCRIBED',
  'DID_RENEW',
  'DID_FAIL_TO_RENEW',
  'GRACE_PERIOD_EXPIRED',
  'EXPIRED',
  'REVOKE',
  'DID_CHANGE_RENEWAL_PREF',
  'DID_CHANGE_RENEWAL_STATUS',
  'REFUND',
  'REFUND_REVERSED',
  'REFUND_DECLINED',
  'CONSUMPTION_REQUEST',
  'TEST',
]);

const notificationEncryptionContext = (notificationUuid: string): string =>
  `app-store-notification:${notificationUuid}`;

export type NotificationIngestErrorCode = 'NOTIFICATION_UNVERIFIED' | 'STORAGE_UNAVAILABLE';

export class NotificationIngestError extends Error {
  readonly code: NotificationIngestErrorCode;

  constructor(code: NotificationIngestErrorCode, cause?: unknown) {
    super(`App Store notification ingest failed: ${code}.`, { cause });
    this.name = 'NotificationIngestError';
    this.code = code;
  }
}

interface NotificationIngestServiceOptions {
  client: PrismaClient;
  commerce: CommerceEnvironment;
  now?: () => Date;
  verifier: SignedNotificationVerifier;
}

/**
 * Receives App Store Server Notifications V2: verifies the outer JWS, then
 * durably persists the encrypted verified envelope before acknowledgement.
 * Transport duplicates deduplicate by notificationUUID; business effects
 * deduplicate later inside the shared application service.
 */
export class AppStoreNotificationIngestService {
  private readonly client: PrismaClient;
  private readonly commerce: CommerceEnvironment;
  private readonly now: () => Date;
  private readonly verifier: SignedNotificationVerifier;

  constructor(options: NotificationIngestServiceOptions) {
    this.client = options.client;
    this.commerce = options.commerce;
    this.now = options.now ?? (() => new Date());
    this.verifier = options.verifier;
  }

  async ingest(signedPayload: string): Promise<{ notificationUuid: string }> {
    let decoded;
    try {
      decoded = await this.verifier.verifyNotification(signedPayload);
    } catch (error) {
      throw new NotificationIngestError('NOTIFICATION_UNVERIFIED', error);
    }

    const notificationUuid = decoded.notificationUUID ?? null;
    const notificationType = decoded.notificationType ?? null;
    if (notificationUuid === null || notificationType === null) {
      throw new NotificationIngestError('NOTIFICATION_UNVERIFIED');
    }

    const now = this.now();
    const sourceAt = decoded.signedDate === undefined ? now : new Date(decoded.signedDate);
    const encrypted = encryptBytes(
      Buffer.from(signedPayload, 'utf8'),
      this.commerce.notificationEncryptionKeys,
      notificationEncryptionContext(notificationUuid),
    );

    try {
      await this.client.appStoreNotification.upsert({
        where: { notificationUuid },
        create: {
          notificationUuid,
          notificationType,
          notificationSubtype: decoded.subtype ?? null,
          environment: this.commerce.environment,
          payloadHash: createHash('sha256').update(signedPayload, 'utf8').digest('hex'),
          encryptedPayload: new Uint8Array(encrypted.encrypted),
          encryptionKeyVersion: encrypted.keyVersion,
          payloadDeleteAt: new Date(
            now.getTime() + this.commerce.notificationRawTtlDays * 86_400_000,
          ),
          processingStatus: 'RECEIVED',
          sourceAt,
        },
        // A redelivered transport duplicate keeps the original envelope.
        update: {},
      });
    } catch (error) {
      throw new NotificationIngestError('STORAGE_UNAVAILABLE', error);
    }

    return { notificationUuid };
  }
}

interface NotificationWorkerOptions {
  application: IapApplicationService;
  client: PrismaClient;
  commerce: CommerceEnvironment;
  consumption?: ConsumptionRequestHandler;
  leaseSeconds?: number;
  logger?: ApiLogger;
  maximumAttempts?: number;
  now?: () => Date;
  verifier: SignedNotificationVerifier & SignedTransactionVerifier;
  workerId?: string;
}

interface ClaimedNotification {
  attemptCount: number;
  encryptedPayload: Uint8Array | null;
  encryptionKeyVersion: string | null;
  id: string;
  notificationType: string;
  notificationUuid: string;
  sourceAt: Date;
}

/**
 * Database-backed worker for durable notification rows. Rows are claimed
 * with leases over FOR UPDATE SKIP LOCKED, so repeated or concurrent workers
 * are harmless; every business effect goes through the shared idempotent
 * application service.
 */
export class AppStoreNotificationWorker {
  private readonly application: IapApplicationService;
  private readonly client: PrismaClient;
  private readonly commerce: CommerceEnvironment;
  private readonly consumption: ConsumptionRequestHandler | undefined;
  private readonly leaseSeconds: number;
  private readonly logger: ApiLogger | undefined;
  private readonly maximumAttempts: number;
  private readonly now: () => Date;
  private readonly verifier: SignedNotificationVerifier & SignedTransactionVerifier;
  private readonly workerId: string;

  constructor(options: NotificationWorkerOptions) {
    this.application = options.application;
    this.client = options.client;
    this.commerce = options.commerce;
    this.consumption = options.consumption;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.logger = options.logger;
    this.maximumAttempts = options.maximumAttempts ?? 8;
    this.now = options.now ?? (() => new Date());
    this.verifier = options.verifier;
    this.workerId = options.workerId ?? `worker:${randomUUID()}`;
  }

  /** Claims and processes up to `limit` pending rows. Returns processed count. */
  async runOnce(limit = 10): Promise<number> {
    const claimed = await this.claim(limit);
    for (const notification of claimed) {
      await this.process(notification);
    }
    return claimed.length;
  }

  /** Crypto-erases raw payloads past their bounded retention deadline. */
  async purgeExpiredPayloads(): Promise<number> {
    const result = await this.client.appStoreNotification.updateMany({
      where: { payloadDeleteAt: { lte: this.now() }, encryptedPayload: { not: null } },
      data: { encryptedPayload: null, encryptionKeyVersion: null },
    });
    return result.count;
  }

  private async claim(limit: number): Promise<ClaimedNotification[]> {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseSeconds * 1_000);
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const rows = await transaction.$queryRaw<
        {
          attemptCount: number;
          encryptedPayload: Uint8Array | null;
          encryptionKeyVersion: string | null;
          id: string;
          notificationType: string;
          notificationUuid: string;
          sourceAt: Date;
        }[]
      >`
        SELECT "id", "notificationUuid", "notificationType", "encryptedPayload",
               "encryptionKeyVersion", "attemptCount", "sourceAt"
        FROM "AppStoreNotification"
        WHERE ("processingStatus" = 'RECEIVED')
           OR ("processingStatus" = 'RETRYABLE_FAILURE')
           OR ("processingStatus" = 'PROCESSING' AND "leaseExpiresAt" < ${now})
        ORDER BY "receivedAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) {
        return [];
      }
      await transaction.appStoreNotification.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
          processingStatus: 'PROCESSING',
          leaseOwner: this.workerId,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        },
      });
      return rows;
    });
  }

  private async process(notification: ClaimedNotification): Promise<void> {
    try {
      const outcome = await this.processClaimed(notification);
      await this.finish(notification.id, outcome.status, outcome.errorCode ?? null);
    } catch (error) {
      const retryable =
        (error instanceof IapApplicationError && error.code === 'RETRYABLE_CONFLICT') ||
        !(error instanceof IapApplicationError || error instanceof RangeError);
      const exhausted = notification.attemptCount + 1 >= this.maximumAttempts;
      const status: AppStoreNotificationProcessingStatus =
        retryable && !exhausted ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE';
      const errorCode =
        error instanceof IapApplicationError
          ? error.code
          : error instanceof SignedTransactionVerificationError
            ? error.code
            : 'PROCESSING_ERROR';
      this.logger?.warn(
        {
          errorCode,
          notificationUuid: notification.notificationUuid,
          notificationType: notification.notificationType,
          status,
        },
        'App Store notification processing failed',
      );
      await this.finish(notification.id, status, errorCode);
    }
  }

  private async processClaimed(notification: ClaimedNotification): Promise<{
    errorCode?: string;
    status: AppStoreNotificationProcessingStatus;
  }> {
    if (!handledNotificationTypes.has(notification.notificationType)) {
      // Unknown future types keep their encrypted payload for the bounded
      // replay window and are acknowledged safely.
      return { status: 'UNKNOWN_RETAINED' };
    }
    if (notification.notificationType === 'TEST') {
      return { status: 'APPLIED' };
    }

    if (notification.encryptedPayload === null || notification.encryptionKeyVersion === null) {
      return { errorCode: 'PAYLOAD_ERASED', status: 'TERMINAL_FAILURE' };
    }
    const signedPayload = decryptBytes(
      Buffer.from(notification.encryptedPayload),
      notification.encryptionKeyVersion,
      this.commerce.notificationEncryptionKeys,
      notificationEncryptionContext(notification.notificationUuid),
    ).toString('utf8');

    const decoded = await this.verifier.verifyNotification(signedPayload);
    const signedTransactionInfo = decoded.data?.signedTransactionInfo;
    if (signedTransactionInfo === undefined) {
      return { errorCode: 'MISSING_TRANSACTION', status: 'TERMINAL_FAILURE' };
    }

    // Independently verify the nested transaction and renewal JWS.
    const verified = await this.verifier.verifyTransaction(signedTransactionInfo);
    const renewalFact =
      decoded.data?.signedRenewalInfo === undefined
        ? null
        : await this.verifier.verifyRenewalInfo(decoded.data.signedRenewalInfo);

    if (notification.notificationType === 'CONSUMPTION_REQUEST') {
      await this.consumption?.handleConsumptionRequest({
        notificationUuid: notification.notificationUuid,
        verified,
      });
      return { status: 'APPLIED' };
    }

    let refundEventType: RefundEventType | null = null;
    if (notification.notificationType === 'REFUND') {
      refundEventType = 'REFUND';
    } else if (notification.notificationType === 'REFUND_REVERSED') {
      refundEventType = 'REFUND_REVERSED';
    }
    // REFUND_DECLINED and preference changes change no benefit directly;
    // the idempotent application still records facts and recomputes state.

    await this.application.apply(verified, {
      authorityRank: 0,
      refundEventType,
      renewalFact,
      sourceAt: notification.sourceAt,
      sourceId: `notification:${notification.notificationUuid}`,
    });

    return { status: 'APPLIED' };
  }

  private async finish(
    id: string,
    status: AppStoreNotificationProcessingStatus,
    errorCode: string | null,
  ): Promise<void> {
    await this.client.appStoreNotification.update({
      where: { id },
      data: {
        processingStatus: status,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
      },
    });
  }
}
