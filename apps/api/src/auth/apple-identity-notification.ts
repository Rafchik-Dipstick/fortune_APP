import { createHash } from 'node:crypto';

import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyOptions,
} from 'jose';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { DatabaseError } from '../db/errors.js';
import { lockUserForUpdate, runReadCommittedTransaction } from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { createAppleIdentityDigests } from './apple-identity-token.js';

const appleIssuer = 'https://appleid.apple.com';
const appleJwksUrl = new URL(`${appleIssuer}/auth/keys`);
const notificationRoute = '/v1/webhooks/sign-in-with-apple';
const notificationRetentionMilliseconds = 365 * 86_400_000;

export type AppleIdentityNotificationType =
  'account-deleted' | 'consent-revoked' | 'email-disabled' | 'email-enabled' | (string & {});

export interface VerifiedAppleIdentityNotification {
  eventAt: Date;
  identityCandidates: readonly { digest: string; keyVersion: string }[];
  notificationId: string;
  requestHash: string;
  type: AppleIdentityNotificationType;
}

export type AppleIdentityNotificationErrorCode =
  'IDENTITY_CONFLICT' | 'INVALID_NOTIFICATION' | 'KEY_UNAVAILABLE';

export class AppleIdentityNotificationError extends Error {
  readonly code: AppleIdentityNotificationErrorCode;

  constructor(code: AppleIdentityNotificationErrorCode, cause?: unknown) {
    super(`Sign in with Apple notification failed: ${code}.`, { cause });
    this.name = 'AppleIdentityNotificationError';
    this.code = code;
  }
}

type JwtVerifier = (token: string, options: JWTVerifyOptions) => Promise<{ payload: JWTPayload }>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppleKeyAvailabilityError(error: unknown): boolean {
  return error instanceof errors.JWKSTimeout || error instanceof TypeError;
}

function stableNotificationUuid(jti: string): string {
  const bytes = createHash('sha256').update(`sign-in-with-apple-notification:${jti}`).digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = bytes.subarray(0, 16).toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export interface AppleIdentityNotificationVerifier {
  verify(signedPayload: string): Promise<VerifiedAppleIdentityNotification>;
}

export class AppleIdentityNotificationTokenVerifier implements AppleIdentityNotificationVerifier {
  private readonly verifyJwt: JwtVerifier;

  constructor(
    private readonly environment: AuthenticationEnvironment,
    private readonly now: () => Date = () => new Date(),
    verifyJwt?: JwtVerifier,
  ) {
    const remoteKeys = createRemoteJWKSet(appleJwksUrl, {
      timeoutDuration: environment.appleIdentityJwksTimeoutMs,
    });
    this.verifyJwt =
      verifyJwt ??
      ((token, options) =>
        jwtVerify(token, remoteKeys, {
          ...options,
          algorithms: ['RS256'],
          audience: environment.bundleId,
          issuer: appleIssuer,
        }));
  }

  async verify(signedPayload: string): Promise<VerifiedAppleIdentityNotification> {
    const now = this.now();
    let payload: JWTPayload;
    try {
      ({ payload } = await this.verifyJwt(signedPayload, {
        algorithms: ['RS256'],
        audience: this.environment.bundleId,
        clockTolerance: this.environment.appleIdentityTokenClockSkewSeconds,
        currentDate: now,
        issuer: appleIssuer,
      }));
    } catch (error) {
      throw new AppleIdentityNotificationError(
        isAppleKeyAvailabilityError(error) ? 'KEY_UNAVAILABLE' : 'INVALID_NOTIFICATION',
        error,
      );
    }

    const events = payload['events'];
    const type = isPlainRecord(events) ? events['type'] : undefined;
    const subject = isPlainRecord(events) ? events['sub'] : undefined;
    const eventTime = isPlainRecord(events) ? events['event_time'] : undefined;
    if (
      typeof payload.jti !== 'string' ||
      payload.jti.length === 0 ||
      payload.jti.length > 256 ||
      typeof payload.iat !== 'number' ||
      !Number.isInteger(payload.iat) ||
      typeof type !== 'string' ||
      type.length === 0 ||
      type.length > 80 ||
      typeof subject !== 'string' ||
      subject.length === 0 ||
      subject.length > 256 ||
      typeof eventTime !== 'number' ||
      !Number.isInteger(eventTime)
    ) {
      throw new AppleIdentityNotificationError('INVALID_NOTIFICATION');
    }

    const maximumFutureSeconds =
      Math.floor(now.getTime() / 1_000) + this.environment.appleIdentityTokenClockSkewSeconds;
    if (payload.iat > maximumFutureSeconds || eventTime > maximumFutureSeconds) {
      throw new AppleIdentityNotificationError('INVALID_NOTIFICATION');
    }

    return {
      eventAt: new Date(eventTime * 1_000),
      identityCandidates: createAppleIdentityDigests(subject, this.environment).identityCandidates,
      notificationId: stableNotificationUuid(payload.jti),
      requestHash: createHash('sha256').update(signedPayload, 'utf8').digest('hex'),
      type,
    };
  }
}

export class AppleIdentityNotificationService {
  private readonly now: () => Date;

  constructor(
    private readonly client: PrismaClient,
    private readonly verifier: AppleIdentityNotificationVerifier,
    now: () => Date = () => new Date(),
  ) {
    this.now = now;
  }

  async ingest(signedPayload: string): Promise<{ notificationId: string }> {
    const verified = await this.verifier.verify(signedPayload);
    const now = this.now();
    try {
      await runReadCommittedTransaction(
        this.client,
        async (transaction) => {
          await transaction.idempotencyRecord.create({
            data: {
              actorType: 'APPLE_NOTIFICATION',
              actorId: 'sign-in-with-apple',
              method: 'POST',
              normalizedRoute: notificationRoute,
              key: verified.notificationId,
              requestHash: verified.requestHash,
              retainUntil: new Date(now.getTime() + notificationRetentionMilliseconds),
            },
          });

          const userId = await this.resolveUserId(transaction, verified.identityCandidates);
          if (userId !== null) {
            await this.applyEvent(transaction, userId, verified, now);
          }

          await transaction.idempotencyRecord.update({
            where: {
              actorType_actorId_method_normalizedRoute_key: {
                actorType: 'APPLE_NOTIFICATION',
                actorId: 'sign-in-with-apple',
                method: 'POST',
                normalizedRoute: notificationRoute,
                key: verified.notificationId,
              },
            },
            data: {
              outcomeStatus: 'COMPLETED',
              httpStatus: 200,
              resultReference: userId === null ? 'identity:not-found' : `event:${verified.type}`,
            },
          });
        },
        { name: 'apple-identity-notification' },
      );
    } catch (error) {
      if (error instanceof DatabaseError && error.kind === 'UNIQUE_CONSTRAINT') {
        return { notificationId: verified.notificationId };
      }
      throw error;
    }
    return { notificationId: verified.notificationId };
  }

  private async resolveUserId(
    transaction: Prisma.TransactionClient,
    candidates: readonly { digest: string; keyVersion: string }[],
  ): Promise<string | null> {
    const identities = await transaction.externalIdentity.findMany({
      where: {
        provider: 'SIGN_IN_WITH_APPLE',
        OR: candidates.map((candidate) => ({
          keyVersion: candidate.keyVersion,
          subjectDigest: candidate.digest,
        })),
      },
      select: { userId: true },
    });
    const userIds = [...new Set(identities.map((identity) => identity.userId))];
    if (userIds.length > 1) {
      throw new AppleIdentityNotificationError('IDENTITY_CONFLICT');
    }
    return userIds[0] ?? null;
  }

  private async applyEvent(
    transaction: Prisma.TransactionClient,
    userId: string,
    notification: VerifiedAppleIdentityNotification,
    now: Date,
  ): Promise<void> {
    const user = await lockUserForUpdate(transaction, userId);
    if (notification.type === 'consent-revoked') {
      if (user.status !== 'PURGED') {
        await transaction.user.update({
          where: { id: userId },
          data: { sessionVersion: { increment: 1 }, updatedAt: now },
        });
        await transaction.sessionFamily.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'APPLE_CONSENT_REVOKED' },
        });
      }
    } else if (notification.type === 'account-deleted') {
      await this.queueImmediatePurge(transaction, userId, user.status, now);
    }

    await transaction.auditEvent.create({
      data: {
        actorType: 'APPLE',
        actorId: notification.notificationId,
        action: `SIGN_IN_WITH_APPLE_${notification.type.toUpperCase().replaceAll('-', '_')}`.slice(
          0,
          120,
        ),
        targetType: 'USER',
        targetId: userId,
        metadata: {
          eventAt: notification.eventAt.toISOString(),
          eventType: notification.type,
        },
        createdAt: now,
      },
    });
  }

  private async queueImmediatePurge(
    transaction: Prisma.TransactionClient,
    userId: string,
    status: 'ACTIVE' | 'BLOCKED' | 'DELETION_PENDING' | 'PURGED',
    now: Date,
  ): Promise<void> {
    if (status === 'PURGED') {
      return;
    }
    // The database timeline invariant requires purgeAt to be strictly later
    // than requestedAt. One millisecond is still effectively immediate while
    // preserving that invariant for a request created by this event.
    const immediatePurgeAt = new Date(now.getTime() + 1);
    const pending = await transaction.accountDeletionRequest.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    });
    if (pending === null) {
      await transaction.accountDeletionRequest.create({
        data: { userId, status: 'PENDING', requestedAt: now, purgeAt: immediatePurgeAt },
      });
    } else if (pending.purgeAt > immediatePurgeAt) {
      await transaction.accountDeletionRequest.update({
        where: { id: pending.id },
        data: { purgeAt: immediatePurgeAt, leaseOwner: null, leaseUntil: null },
      });
    }
    await transaction.user.update({
      where: { id: userId },
      data: {
        status: 'DELETION_PENDING',
        sessionVersion: { increment: 1 },
        updatedAt: now,
      },
    });
    await transaction.sessionFamily.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revocationReason: 'APPLE_ACCOUNT_DELETED' },
    });
  }
}
