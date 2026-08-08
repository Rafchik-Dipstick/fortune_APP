import { createHash } from 'node:crypto';

import {
  refreshSessionResponseSchema,
  type RefreshSessionRequest,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { DatabaseError } from '../db/errors.js';
import {
  lockUserThenSessionFamilyThenRefreshToken,
  runReadCommittedTransaction,
  type LockedRefreshToken,
  type LockedSessionFamily,
  type LockedUser,
} from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import {
  createCurrentHmacDigest,
  createHmacDigestCandidates,
  createOpaqueToken,
  decryptBytes,
  encryptBytes,
} from '../security/crypto.js';
import { type AccessTokenService } from './access-token.js';

const refreshTokenDigestPrefix = 'refresh-token:';
const deviceDigestPrefix = 'session-device:';
const replayReceiptContextPrefix = 'refresh-replay:';
const replayReceiptLifetimeMs = 120_000;

export type RefreshSessionErrorCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED' | 'IDEMPOTENCY_KEY_REUSED';

export class RefreshSessionError extends Error {
  readonly code: RefreshSessionErrorCode;

  constructor(code: RefreshSessionErrorCode, cause?: unknown) {
    super(`Session refresh failed: ${code}.`, { cause });
    this.name = 'RefreshSessionError';
    this.code = code;
  }
}

interface RefreshSessionDependencies {
  accessTokens: AccessTokenService;
  client: PrismaClient;
  environment: AuthenticationEnvironment;
  now?: () => Date;
  opaqueTokenFactory?: () => string;
}

interface RefreshTarget {
  familyId: string;
  refreshTokenId: string;
  storedTokenHash: string;
  userId: string;
}

type RefreshTransactionOutcome =
  | { kind: 'REJECTED'; code: RefreshSessionErrorCode }
  | { kind: 'SUCCESS'; response: RefreshSessionResponse };

function toPrismaBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
}

function createRequestHash(request: RefreshSessionRequest, storedTokenHash: string): string {
  return createHash('sha256')
    .update('refresh-request-v1\0', 'utf8')
    .update(storedTokenHash, 'ascii')
    .update('\0', 'utf8')
    .update(request.device.id, 'utf8')
    .update('\0', 'utf8')
    .update(request.device.description ?? '', 'utf8')
    .digest('hex');
}

function receiptContext(
  refreshTokenId: string,
  idempotencyKey: string,
  requestHash: string,
): string {
  return `${replayReceiptContextPrefix}${refreshTokenId}:${idempotencyKey}:${requestHash}`;
}

function assertActiveLockedSession(
  user: LockedUser,
  family: LockedSessionFamily,
  refreshToken: LockedRefreshToken,
  now: Date,
): void {
  if (user.status === 'DELETION_PENDING') {
    throw new RefreshSessionError('ACCOUNT_DELETION_PENDING');
  }
  if (user.status === 'PURGED') {
    throw new RefreshSessionError('ACCOUNT_PURGED');
  }
  if (
    user.status !== 'ACTIVE' ||
    family.revokedAt !== null ||
    family.expiresAt <= now ||
    refreshToken.expiresAt <= now ||
    family.sessionVersion !== user.sessionVersion
  ) {
    throw new RefreshSessionError('AUTH_REQUIRED');
  }
}

export class RefreshSessionService {
  private readonly accessTokens: AccessTokenService;
  private readonly client: PrismaClient;
  private readonly environment: AuthenticationEnvironment;
  private readonly now: () => Date;
  private readonly opaqueTokenFactory: () => string;

  constructor(dependencies: RefreshSessionDependencies) {
    this.accessTokens = dependencies.accessTokens;
    this.client = dependencies.client;
    this.environment = dependencies.environment;
    this.now = dependencies.now ?? (() => new Date());
    this.opaqueTokenFactory = dependencies.opaqueTokenFactory ?? createOpaqueToken;
  }

  async refresh(
    request: RefreshSessionRequest,
    idempotencyKey: string,
  ): Promise<RefreshSessionResponse> {
    const target = await this.findTarget(request.refreshToken);
    const requestHash = createRequestHash(request, target.storedTokenHash);
    let outcome: RefreshTransactionOutcome;
    try {
      outcome = await runReadCommittedTransaction(this.client, (transaction) =>
        this.rotate(transaction, target, request, idempotencyKey, requestHash),
      );
    } catch (error) {
      if (error instanceof DatabaseError && error.kind === 'NOT_FOUND') {
        throw new RefreshSessionError('AUTH_REQUIRED', error);
      }
      throw error;
    }
    if (outcome.kind === 'REJECTED') {
      throw new RefreshSessionError(outcome.code);
    }
    return outcome.response;
  }

  private async findTarget(rawRefreshToken: string): Promise<RefreshTarget> {
    const candidates = createHmacDigestCandidates(
      `${refreshTokenDigestPrefix}${rawRefreshToken}`,
      this.environment.refreshTokenHmacKeys,
    );
    const matches = await this.client.refreshToken.findMany({
      where: { tokenHash: { in: candidates.map((candidate) => candidate.digest) } },
      include: { family: true },
      take: 2,
    });
    if (matches.length !== 1) {
      throw new RefreshSessionError('AUTH_REQUIRED');
    }
    const match = matches[0];
    if (match === undefined) {
      throw new RefreshSessionError('AUTH_REQUIRED');
    }
    return {
      familyId: match.familyId,
      refreshTokenId: match.id,
      storedTokenHash: match.tokenHash,
      userId: match.family.userId,
    };
  }

  private async rotate(
    transaction: Prisma.TransactionClient,
    target: RefreshTarget,
    request: RefreshSessionRequest,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<RefreshTransactionOutcome> {
    const locked = await lockUserThenSessionFamilyThenRefreshToken(transaction, {
      userId: target.userId,
      familyId: target.familyId,
      refreshTokenId: target.refreshTokenId,
    });
    const now = this.now();
    if (locked.refreshToken.tokenHash !== target.storedTokenHash) {
      throw new RefreshSessionError('AUTH_REQUIRED');
    }
    assertActiveLockedSession(locked.user, locked.family, locked.refreshToken, now);

    if (locked.refreshToken.consumedAt !== null) {
      return this.replayOrRevoke(
        transaction,
        locked.refreshToken,
        locked.family,
        idempotencyKey,
        requestHash,
        now,
      );
    }

    const replacementToken = this.opaqueTokenFactory();
    const replacementDigest = createCurrentHmacDigest(
      `${refreshTokenDigestPrefix}${replacementToken}`,
      this.environment.refreshTokenHmacKeys,
    );
    const deviceDigest = createCurrentHmacDigest(
      `${deviceDigestPrefix}${request.device.id}`,
      this.environment.refreshTokenHmacKeys,
    );
    await transaction.refreshToken.update({
      where: { id: locked.refreshToken.id },
      data: { consumedAt: now, idempotencyKey, requestHash },
    });
    await transaction.refreshToken.create({
      data: {
        familyId: locked.family.id,
        tokenHash: replacementDigest.digest,
        predecessorId: locked.refreshToken.id,
        expiresAt: locked.family.expiresAt,
        deviceIdHash: deviceDigest.digest,
        ...(request.device.description === undefined
          ? {}
          : { deviceDescription: request.device.description }),
        createdAt: now,
      },
    });
    const access = await this.accessTokens.issue({
      userId: locked.user.id,
      sessionFamilyId: locked.family.id,
      sessionVersion: locked.user.sessionVersion,
      authTime: locked.family.identityAuthenticatedAt,
    });
    const response = refreshSessionResponseSchema.parse({
      session: {
        accessToken: access.accessToken,
        refreshToken: replacementToken,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshTokenExpiresAt: locked.family.expiresAt.toISOString(),
        authTime: locked.family.identityAuthenticatedAt.toISOString(),
      },
    });
    const receipt = encryptBytes(
      Buffer.from(JSON.stringify(response), 'utf8'),
      this.environment.refreshReplayEncryptionKeys,
      receiptContext(locked.refreshToken.id, idempotencyKey, requestHash),
    );
    await transaction.refreshReplayReceipt.create({
      data: {
        refreshTokenId: locked.refreshToken.id,
        idempotencyKey,
        requestHash,
        encryptedResponse: toPrismaBytes(receipt.encrypted),
        encryptionKeyVersion: receipt.keyVersion,
        expiresAt: new Date(now.getTime() + replayReceiptLifetimeMs),
        createdAt: now,
      },
    });
    return { kind: 'SUCCESS', response };
  }

  private async replayOrRevoke(
    transaction: Prisma.TransactionClient,
    refreshToken: LockedRefreshToken,
    family: LockedSessionFamily,
    idempotencyKey: string,
    requestHash: string,
    now: Date,
  ): Promise<RefreshTransactionOutcome> {
    const sameIdempotencyKey = refreshToken.idempotencyKey === idempotencyKey;
    const sameRequest = refreshToken.requestHash === requestHash;
    if (sameIdempotencyKey && sameRequest) {
      const receipt = await transaction.refreshReplayReceipt.findUnique({
        where: { refreshTokenId: refreshToken.id },
      });
      if (receipt !== null && receipt.expiresAt > now) {
        try {
          const decrypted = decryptBytes(
            Buffer.from(receipt.encryptedResponse),
            receipt.encryptionKeyVersion,
            this.environment.refreshReplayEncryptionKeys,
            receiptContext(refreshToken.id, idempotencyKey, requestHash),
          );
          return {
            kind: 'SUCCESS',
            response: refreshSessionResponseSchema.parse(JSON.parse(decrypted.toString('utf8'))),
          };
        } catch {
          // A missing key or invalid receipt must fail closed and revoke below.
        }
      }
    }

    await transaction.sessionFamily.update({
      where: { id: family.id },
      data: { revokedAt: now, revocationReason: 'REFRESH_REUSE' },
    });
    return {
      kind: 'REJECTED',
      code: sameIdempotencyKey && !sameRequest ? 'IDEMPOTENCY_KEY_REUSED' : 'AUTH_REQUIRED',
    };
  }
}
