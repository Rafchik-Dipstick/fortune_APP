import { performance } from 'node:perf_hooks';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { recordDatabaseLatency } from '../observability/metrics.js';

import { DatabaseError, isRetryableTransactionError, mapDatabaseError } from './errors.js';

const maximumAttempts = 5;
const maximumBackoffMs = 200;

export interface TransactionRetryOptions {
  attempts?: number;
  /** Metric label for this unit of database work. Never account-scoped. */
  name?: string;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface LockedUser {
  activeFinancialSubjectId: string | null;
  id: string;
  sessionVersion: number;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETION_PENDING' | 'PURGED';
}

export interface LockedFinancialSubject {
  benefitsDisabledAt: Date | null;
  id: string;
}

export interface LockedSessionFamily {
  expiresAt: Date;
  identityAuthenticatedAt: Date;
  id: string;
  revokedAt: Date | null;
  sessionVersion: number;
  userId: string;
}

export interface LockedRefreshToken {
  consumedAt: Date | null;
  expiresAt: Date;
  familyId: string;
  id: string;
  idempotencyKey: string | null;
  requestHash: string | null;
  tokenHash: string;
}

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

function getBackoffMs(attempt: number, random: () => number): number {
  const exponentialMaximum = Math.min(maximumBackoffMs, 20 * 2 ** (attempt - 1));
  return Math.max(1, Math.floor(exponentialMaximum * (0.5 + random() * 0.5)));
}

export async function runReadCommittedTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options: TransactionRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? maximumAttempts;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > maximumAttempts) {
    throw new RangeError(`Transaction attempts must be between 1 and ${String(maximumAttempts)}.`);
  }

  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const operationName = options.name ?? 'transaction';
  const startedAt = performance.now();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 2_000,
        timeout: 10_000,
      });
      recordDatabaseLatency({
        attempts: attempt,
        durationMs: performance.now() - startedAt,
        operation: operationName,
        outcome: 'committed',
      });
      return result;
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < attempts) {
        await sleep(getBackoffMs(attempt, random));
        continue;
      }

      recordDatabaseLatency({
        attempts: attempt,
        durationMs: performance.now() - startedAt,
        operation: operationName,
        outcome: 'failed',
      });
      throw mapDatabaseError(error) ?? error;
    }
  }

  throw new DatabaseError('TRANSACTION_CONFLICT', new Error('Retry loop exhausted.'));
}

export async function lockUserForUpdate(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<LockedUser> {
  const rows = await transaction.$queryRaw<LockedUser[]>`
    SELECT
      "id",
      "status",
      "sessionVersion",
      "activeFinancialSubjectId"
    FROM "User"
    WHERE "id" = ${userId}::uuid
    FOR UPDATE
  `;
  const user = rows[0];
  if (user === undefined) {
    throw new DatabaseError('NOT_FOUND', new Error('User lock target does not exist.'));
  }
  return user;
}

export async function lockFinancialSubjectForUpdate(
  transaction: Prisma.TransactionClient,
  financialSubjectId: string,
): Promise<LockedFinancialSubject> {
  const rows = await transaction.$queryRaw<LockedFinancialSubject[]>`
    SELECT "id", "benefitsDisabledAt"
    FROM "FinancialSubject"
    WHERE "id" = ${financialSubjectId}::uuid
    FOR UPDATE
  `;
  const financialSubject = rows[0];
  if (financialSubject === undefined) {
    throw new DatabaseError(
      'NOT_FOUND',
      new Error('Financial-subject lock target does not exist.'),
    );
  }
  return financialSubject;
}

export async function lockUserThenFinancialSubject(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<{
  financialSubject: LockedFinancialSubject | undefined;
  user: LockedUser;
}> {
  const user = await lockUserForUpdate(transaction, userId);
  const financialSubject =
    user.activeFinancialSubjectId === null
      ? undefined
      : await lockFinancialSubjectForUpdate(transaction, user.activeFinancialSubjectId);
  return { user, financialSubject };
}

export async function lockSessionFamilyForUpdate(
  transaction: Prisma.TransactionClient,
  sessionFamilyId: string,
): Promise<LockedSessionFamily> {
  const rows = await transaction.$queryRaw<LockedSessionFamily[]>`
    SELECT
      "id",
      "userId",
      "sessionVersion",
      "gameCenterAuthenticatedAt" AS "identityAuthenticatedAt",
      "expiresAt",
      "revokedAt"
    FROM "SessionFamily"
    WHERE "id" = ${sessionFamilyId}::uuid
    FOR UPDATE
  `;
  const family = rows[0];
  if (family === undefined) {
    throw new DatabaseError('NOT_FOUND', new Error('Session-family lock target does not exist.'));
  }
  return family;
}

export async function lockRefreshTokenForUpdate(
  transaction: Prisma.TransactionClient,
  refreshTokenId: string,
): Promise<LockedRefreshToken> {
  const rows = await transaction.$queryRaw<LockedRefreshToken[]>`
    SELECT
      "id",
      "familyId",
      "tokenHash",
      "consumedAt",
      "expiresAt",
      "requestHash",
      "idempotencyKey"
    FROM "RefreshToken"
    WHERE "id" = ${refreshTokenId}::uuid
    FOR UPDATE
  `;
  const refreshToken = rows[0];
  if (refreshToken === undefined) {
    throw new DatabaseError('NOT_FOUND', new Error('Refresh-token lock target does not exist.'));
  }
  return refreshToken;
}

export async function lockUserThenSessionFamilyThenRefreshToken(
  transaction: Prisma.TransactionClient,
  targets: { familyId: string; refreshTokenId: string; userId: string },
): Promise<{
  family: LockedSessionFamily;
  refreshToken: LockedRefreshToken;
  user: LockedUser;
}> {
  const user = await lockUserForUpdate(transaction, targets.userId);
  const family = await lockSessionFamilyForUpdate(transaction, targets.familyId);
  const refreshToken = await lockRefreshTokenForUpdate(transaction, targets.refreshTokenId);
  if (family.userId !== user.id || refreshToken.familyId !== family.id) {
    throw new DatabaseError('NOT_FOUND', new Error('Session lock targets do not share ownership.'));
  }
  return { user, family, refreshToken };
}
