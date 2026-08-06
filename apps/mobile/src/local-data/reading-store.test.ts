import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { FortuneDraw } from '@fortuneness/api-contracts';

import { AccountReadingStore, initializeReadingDatabase } from './reading-store';

const accountId = '26087e7e-0613-49fd-bd8f-e52dc58652a9';
const draw: FortuneDraw = {
  id: '3a22ad64-e8f6-4e1a-9933-29ec6f5e86c6',
  cardKey: 'major-00-fool',
  cardDisplayNumber: '0',
  cardName: 'The Fool',
  orientation: 'UPRIGHT',
  intention: 'GROWTH',
  resolvedLocale: 'en',
  artAltText: 'A traveler steps toward dawn beneath a bright wandering star.',
  headline: 'Begin before certainty arrives',
  message: 'A beginning may be asking for your attention before every detail is settled.',
  action: 'Choose one small beginning and give it ten honest minutes.',
  affirmation: 'I can meet the unknown with curiosity.',
  allowanceSource: 'FREE_DAILY',
  contentVersion: '2026.08.06',
  issuedAt: '2026-08-06T10:00:00.000Z',
  viewedAt: null,
};

function createDatabase() {
  const transaction = {
    runAsync: vi.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
  };
  const database = {
    execAsync: vi.fn().mockResolvedValue(undefined),
    getFirstAsync: vi.fn().mockResolvedValue(null),
    runAsync: vi.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
    withExclusiveTransactionAsync: vi.fn(
      async (task: (value: typeof transaction) => Promise<void>) => task(transaction),
    ),
  };
  return {
    database: database as unknown as SQLiteDatabase,
    databaseMock: database,
    transaction,
  };
}

describe('AccountReadingStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T10:05:00.000Z'));
  });

  it('initializes an account-partitioned WAL schema', async () => {
    const { database, databaseMock } = createDatabase();

    await initializeReadingDatabase(database);

    const sql = databaseMock.execAsync.mock.calls[0]?.[0] as string;
    expect(sql).toContain('PRAGMA journal_mode = WAL');
    expect(sql).toContain('PRIMARY KEY (account_id, draw_id)');
    expect(sql).toContain('account_id TEXT PRIMARY KEY');
    expect(sql).toContain('REFERENCES readings (account_id, draw_id) ON DELETE CASCADE');
  });

  it('persists a pending reveal atomically with bound account values', async () => {
    const { database, databaseMock, transaction } = createDatabase();
    const store = new AccountReadingStore(database);

    await store.savePendingReveal(accountId, draw);

    expect(databaseMock.withExclusiveTransactionAsync).toHaveBeenCalledOnce();
    expect(transaction.runAsync).toHaveBeenCalledTimes(2);
    for (const [sql, parameters] of transaction.runAsync.mock.calls) {
      expect(sql).not.toContain(accountId);
      expect(parameters).toMatchObject({ $accountId: accountId });
    }
    expect(transaction.runAsync.mock.calls[1]?.[1]).toMatchObject({
      $drawId: draw.id,
      $step: 'ISSUED',
    });
  });

  it('loads and validates only the requested account pending reveal', async () => {
    const { database, databaseMock } = createDatabase();
    databaseMock.getFirstAsync.mockResolvedValue({
      payloadJson: JSON.stringify(draw),
      step: 'CARD_REVEALED',
    });
    const store = new AccountReadingStore(database);

    await expect(store.loadPendingReveal(accountId)).resolves.toEqual({
      draw,
      step: 'CARD_REVEALED',
    });
    expect(databaseMock.getFirstAsync.mock.calls[0]?.[0]).not.toContain(accountId);
    expect(databaseMock.getFirstAsync.mock.calls[0]?.[1]).toEqual({ $accountId: accountId });
  });

  it('purges only the affected account when stored payload is corrupt', async () => {
    const { database, databaseMock, transaction } = createDatabase();
    databaseMock.getFirstAsync.mockResolvedValue({ payloadJson: '{broken', step: 'ISSUED' });
    const store = new AccountReadingStore(database);

    await expect(store.loadPendingReveal(accountId)).resolves.toBeUndefined();

    expect(transaction.runAsync).toHaveBeenCalledTimes(2);
    for (const [sql, parameters] of transaction.runAsync.mock.calls) {
      expect(sql).toMatch(/^DELETE FROM (pending_reveals|readings)/);
      expect(sql).not.toContain(accountId);
      expect(parameters).toEqual({ $accountId: accountId });
    }
  });
});
