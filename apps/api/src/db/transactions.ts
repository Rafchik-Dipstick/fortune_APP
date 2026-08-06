import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

import { DatabaseError, isRetryableTransactionError, mapDatabaseError } from './errors.js';

const maximumAttempts = 5;
const maximumBackoffMs = 200;

export interface TransactionRetryOptions {
  attempts?: number;
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
  creditBalance: number;
  id: string;
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

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 2_000,
        timeout: 10_000,
      });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < attempts) {
        await sleep(getBackoffMs(attempt, random));
        continue;
      }

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
    SELECT "id", "creditBalance", "benefitsDisabledAt"
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
