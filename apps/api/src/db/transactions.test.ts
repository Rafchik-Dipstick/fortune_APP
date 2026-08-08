import { describe, expect, it, vi } from 'vitest';

import { type PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { DatabaseError } from './errors.js';
import {
  lockUserThenFinancialSubject,
  lockUserThenSessionFamilyThenRefreshToken,
  runReadCommittedTransaction,
} from './transactions.js';

describe('runReadCommittedTransaction', () => {
  it('retries transaction conflicts with bounded jitter and returns the committed result', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockRejectedValueOnce({ code: '40P01' })
      .mockResolvedValueOnce('committed');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = { $transaction: transaction } as unknown as PrismaClient;

    await expect(
      runReadCommittedTransaction(client, vi.fn(), { random: () => 0, sleep }),
    ).resolves.toBe('committed');

    expect(transaction).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('maps an exhausted conflict without performing a sixth attempt', async () => {
    const transaction = vi.fn().mockRejectedValue({ code: 'P2034' });
    const client = { $transaction: transaction } as unknown as PrismaClient;

    await expect(
      runReadCommittedTransaction(client, vi.fn(), {
        attempts: 5,
        random: () => 1,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toMatchObject({ kind: 'TRANSACTION_CONFLICT', retryable: true });
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('does not retry unique-constraint failures', async () => {
    const transaction = vi.fn().mockRejectedValue({ code: 'P2002' });
    const client = { $transaction: transaction } as unknown as PrismaClient;

    await expect(runReadCommittedTransaction(client, vi.fn())).rejects.toBeInstanceOf(
      DatabaseError,
    );
    expect(transaction).toHaveBeenCalledOnce();
  });
});

describe('database row lock order', () => {
  it('locks User before its active FinancialSubject', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'ACTIVE',
          sessionVersion: 1,
          activeFinancialSubjectId: '22222222-2222-4222-8222-222222222222',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          benefitsDisabledAt: null,
        },
      ]);
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    const locked = await lockUserThenFinancialSubject(
      transaction,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(locked.user.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(locked.financialSubject?.id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('locks User, then SessionFamily, then RefreshToken', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const familyId = '22222222-2222-4222-8222-222222222222';
    const refreshTokenId = '33333333-3333-4333-8333-333333333333';
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        { id: userId, status: 'ACTIVE', sessionVersion: 3, activeFinancialSubjectId: null },
      ])
      .mockResolvedValueOnce([
        {
          id: familyId,
          userId,
          sessionVersion: 3,
          identityAuthenticatedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: refreshTokenId,
          familyId,
          tokenHash: 'a'.repeat(64),
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          requestHash: null,
          idempotencyKey: null,
        },
      ]);
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    const locked = await lockUserThenSessionFamilyThenRefreshToken(transaction, {
      userId,
      familyId,
      refreshTokenId,
    });

    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(locked.user.id).toBe(userId);
    expect(locked.family.id).toBe(familyId);
    expect(locked.refreshToken.id).toBe(refreshTokenId);
  });
});
