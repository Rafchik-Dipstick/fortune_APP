import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CollectionCard, CollectionResponse, FortuneDraw } from '@fortuneness/api-contracts';

import { AccountArchiveStore } from './archive-store';
import { AccountReadingStore, initializeReadingDatabase } from './reading-store';

const accountId = '26087e7e-0613-49fd-bd8f-e52dc58652a9';
const otherAccountId = '9c1f52aa-70ad-4f42-9a2e-b8f22c1cf6ff';

/** Maps the expo-sqlite async surface onto a real in-memory SQLite database. */
function createRealDatabase(): { database: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const adapter = {
    execAsync: (sql: string) => {
      raw.exec(sql);
      return Promise.resolve();
    },
    runAsync: (sql: string, parameters?: Record<string, unknown>) => {
      const result =
        parameters === undefined
          ? raw.prepare(sql).run()
          : raw.prepare(sql).run(parameters as Record<string, string | number>);
      return Promise.resolve({
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      });
    },
    getFirstAsync: (sql: string, parameters?: Record<string, unknown>) => {
      const row =
        parameters === undefined
          ? raw.prepare(sql).get()
          : raw.prepare(sql).get(parameters as Record<string, string | number>);
      return Promise.resolve(row ?? null);
    },
    getAllAsync: (sql: string, parameters?: Record<string, unknown>) => {
      const rows =
        parameters === undefined
          ? raw.prepare(sql).all()
          : raw.prepare(sql).all(parameters as Record<string, string | number>);
      return Promise.resolve(rows);
    },
    withExclusiveTransactionAsync: async (task: (transaction: unknown) => Promise<void>) => {
      raw.exec('BEGIN EXCLUSIVE');
      try {
        await task(adapter);
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { database: adapter as unknown as SQLiteDatabase, raw };
}

function drawFixture(index: number, overrides: Partial<FortuneDraw> = {}): FortuneDraw {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
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
    issuedAt: new Date(Date.UTC(2026, 7, 6, 10, 0, 0) - index * 60_000).toISOString(),
    viewedAt: new Date(Date.UTC(2026, 7, 6, 10, 0, 30) - index * 60_000).toISOString(),
    ...overrides,
  };
}

const suits = ['WANDS', 'CUPS', 'SWORDS', 'PENTACLES'] as const;

function collectionFixture(): CollectionResponse {
  const cards: CollectionCard[] = Array.from({ length: 78 }, (_, sortOrder) => {
    const major = sortOrder < 22;
    return {
      key: major ? `major-${String(sortOrder).padStart(2, '0')}-card` : `card-${String(sortOrder)}`,
      displayNumber: String(sortOrder),
      name: `Card ${String(sortOrder)}`,
      arcana: major ? 'MAJOR' : 'MINOR',
      suit: major ? null : (suits[sortOrder % 4] ?? 'WANDS'),
      rank: major ? null : 'ACE',
      artAltText: 'A quiet celestial scene rendered for one canonical tarot card.',
      sortOrder,
      unlocked: false,
      readingCount: 0,
      firstDiscoveredAt: null,
      latestReadingAt: null,
      uprightDiscoveredAt: null,
      reversedDiscoveredAt: null,
    };
  });
  return { cards, unlockedCount: 0, totalCount: 78, syncedAt: '2026-08-06T10:00:00.000Z' };
}

async function createStores() {
  const { database, raw } = createRealDatabase();
  await initializeReadingDatabase(database);
  return {
    archive: new AccountArchiveStore(database),
    raw,
    readings: new AccountReadingStore(database),
  };
}

describe('schema migration', () => {
  it('initializes a fresh database at schema version 2', async () => {
    const { raw } = await createStores();

    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    const columns = raw.prepare('PRAGMA table_info(readings)').all() as { name: string }[];
    const names = columns.map((column) => column.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'card_key',
        'intention',
        'orientation',
        'payload_bytes',
        'last_accessed_at',
      ]),
    );
  });

  it('upgrades an existing v1 database and backfills archive columns', async () => {
    const { database, raw } = createRealDatabase();
    raw.exec(`
      CREATE TABLE readings (
        account_id TEXT NOT NULL,
        draw_id TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        issued_at TEXT NOT NULL,
        viewed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, draw_id)
      );
      CREATE TABLE pending_reveals (
        account_id TEXT PRIMARY KEY,
        draw_id TEXT NOT NULL,
        step TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    const legacyDraw = drawFixture(1);
    raw
      .prepare(
        `INSERT INTO readings (account_id, draw_id, payload_json, issued_at, viewed_at, updated_at)
         VALUES ($accountId, $drawId, $payloadJson, $issuedAt, $viewedAt, $updatedAt)`,
      )
      .run({
        $accountId: accountId,
        $drawId: legacyDraw.id,
        $payloadJson: JSON.stringify(legacyDraw),
        $issuedAt: legacyDraw.issuedAt,
        $viewedAt: legacyDraw.viewedAt,
        $updatedAt: '2026-08-06T10:00:00.000Z',
      });

    await initializeReadingDatabase(database);

    const row = raw
      .prepare(
        `SELECT card_key AS cardKey, intention, orientation, payload_bytes AS payloadBytes,
                last_accessed_at AS lastAccessedAt
         FROM readings WHERE draw_id = $drawId`,
      )
      .get({ $drawId: legacyDraw.id }) as Record<string, unknown>;
    expect(row).toMatchObject({
      cardKey: 'major-00-fool',
      intention: 'GROWTH',
      orientation: 'UPRIGHT',
      lastAccessedAt: '2026-08-06T10:00:00.000Z',
    });
    expect(row.payloadBytes).toBeGreaterThan(100);
    const archive = new AccountArchiveStore(database);
    await expect(archive.loadReadingsPage(accountId, { limit: 10 })).resolves.toEqual([legacyDraw]);
  });

  it('resumes an interrupted v2 migration without duplicate-column failures', async () => {
    const { database, raw } = createRealDatabase();
    raw.exec(`
      CREATE TABLE readings (
        account_id TEXT NOT NULL,
        draw_id TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        issued_at TEXT NOT NULL,
        viewed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, draw_id)
      );
      CREATE TABLE pending_reveals (
        account_id TEXT PRIMARY KEY,
        draw_id TEXT NOT NULL,
        step TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE readings ADD COLUMN card_key TEXT;
      ALTER TABLE readings ADD COLUMN intention TEXT;
      PRAGMA user_version = 1;
    `);

    await initializeReadingDatabase(database);

    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    const columns = raw.prepare('PRAGMA table_info(readings)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['card_key', 'orientation', 'payload_bytes', 'last_accessed_at']),
    );
  });
});

describe('archived reading pages', () => {
  it('pages saved readings in issued order with a keyset boundary', async () => {
    const { archive } = await createStores();
    const draws = Array.from({ length: 25 }, (_, index) => drawFixture(index));
    await archive.saveReadings(accountId, draws);

    const first = await archive.loadReadingsPage(accountId, { limit: 10 });
    expect(first.map((reading) => reading.id)).toEqual(
      draws.slice(0, 10).map((reading) => reading.id),
    );
    const last = first.at(-1);
    if (last === undefined) {
      throw new Error('Expected a full first page.');
    }
    const second = await archive.loadReadingsPage(accountId, {
      before: { drawId: last.id, issuedAt: last.issuedAt },
      limit: 10,
    });
    expect(second.map((reading) => reading.id)).toEqual(
      draws.slice(10, 20).map((reading) => reading.id),
    );
  });

  it('filters saved readings by card, intention, orientation, arcana, and suit', async () => {
    const { archive } = await createStores();
    await archive.saveReadings(accountId, [
      drawFixture(0),
      drawFixture(1, { cardKey: 'cups-queen', intention: 'LOVE', orientation: 'REVERSED' }),
      drawFixture(2, { cardKey: 'wands-03', intention: 'WORK' }),
    ]);

    await expect(
      archive.loadReadingsPage(accountId, { filters: { cardKey: 'cups-queen' }, limit: 10 }),
    ).resolves.toHaveLength(1);
    await expect(
      archive.loadReadingsPage(accountId, { filters: { intention: 'WORK' }, limit: 10 }),
    ).resolves.toHaveLength(1);
    await expect(
      archive.loadReadingsPage(accountId, { filters: { orientation: 'UPRIGHT' }, limit: 10 }),
    ).resolves.toHaveLength(2);
    await expect(
      archive.loadReadingsPage(accountId, { filters: { arcana: 'MAJOR' }, limit: 10 }),
    ).resolves.toHaveLength(1);
    await expect(
      archive.loadReadingsPage(accountId, { filters: { arcana: 'MINOR' }, limit: 10 }),
    ).resolves.toHaveLength(2);
    await expect(
      archive.loadReadingsPage(accountId, { filters: { suit: 'WANDS' }, limit: 10 }),
    ).resolves.toHaveLength(1);
  });

  it('drops rows whose stored payload no longer parses instead of failing the page', async () => {
    const { archive, raw } = await createStores();
    await archive.saveReadings(accountId, [drawFixture(0)]);
    raw
      .prepare(
        `INSERT INTO readings (
          account_id, draw_id, payload_json, issued_at, viewed_at,
          card_key, intention, orientation, payload_bytes, updated_at, last_accessed_at
        ) VALUES ($accountId, 'corrupt-row', '{"not":"a draw"}', '2026-08-06T11:00:00.000Z', NULL,
          'major-00-fool', 'GROWTH', 'UPRIGHT', 16, '2026-08-06T11:00:00.000Z', '2026-08-06T11:00:00.000Z')`,
      )
      .run({ $accountId: accountId });

    const page = await archive.loadReadingsPage(accountId, { limit: 10 });
    expect(page).toHaveLength(1);
    expect(
      raw.prepare("SELECT COUNT(*) AS n FROM readings WHERE draw_id = 'corrupt-row'").get(),
    ).toEqual({ n: 0 });
  });

  it('tracks sync state, known ids, and single readings per account', async () => {
    const { archive } = await createStores();
    const draws = [drawFixture(0), drawFixture(1)];
    await archive.saveReadings(accountId, draws);
    await archive.saveReadings(otherAccountId, [drawFixture(9)]);
    await archive.recordReadingsSyncedAt(accountId, '2026-08-06T10:05:00.000Z');

    const state = await archive.getSyncState(accountId);
    expect(state.readingsSyncedAt).toBe('2026-08-06T10:05:00.000Z');
    expect(state.savedReadingCount).toBe(2);
    expect(state.totalPayloadBytes).toBeGreaterThan(200);

    const firstDraw = draws[0];
    if (firstDraw === undefined) {
      throw new Error('Expected a fixture draw.');
    }
    await expect(
      archive.filterKnownReadingIds(accountId, [
        firstDraw.id,
        'ffffffff-0000-4000-8000-000000000000',
      ]),
    ).resolves.toEqual(new Set([firstDraw.id]));
    await expect(archive.loadReading(accountId, firstDraw.id)).resolves.toEqual(firstDraw);
    await expect(archive.loadReading(otherAccountId, firstDraw.id)).resolves.toBeUndefined();
  });
});

describe('collection summary cache', () => {
  it('round-trips the 78-card summary and clears unparseable rows', async () => {
    const { archive, raw } = await createStores();
    const summary = collectionFixture();
    await archive.saveCollectionSummary(accountId, summary);

    await expect(archive.loadCollectionSummary(accountId)).resolves.toEqual({
      response: summary,
      storedAt: summary.syncedAt,
    });

    raw
      .prepare(
        `UPDATE collection_summaries SET payload_json = '{"cards":[]}' WHERE account_id = $accountId`,
      )
      .run({ $accountId: accountId });
    await expect(archive.loadCollectionSummary(accountId)).resolves.toBeUndefined();
    expect(
      raw
        .prepare('SELECT COUNT(*) AS n FROM collection_summaries WHERE account_id = $accountId')
        .get({ $accountId: accountId }),
    ).toEqual({ n: 0 });
  });
});

describe('cache limit enforcement', () => {
  it('evicts least-recently-used readings above the byte budget while protecting the newest and pending rows', async () => {
    const { archive, raw, readings } = await createStores();
    const draws = Array.from({ length: 12 }, (_, index) => drawFixture(index));
    await archive.saveReadings(accountId, draws);
    const pendingDraw = draws[10];
    const touchedDraw = draws[11];
    if (pendingDraw === undefined || touchedDraw === undefined) {
      throw new Error('Expected fixture draws.');
    }
    await readings.savePendingReveal(accountId, pendingDraw, 'ISSUED');
    // Deterministic LRU order: older access times for higher indexes, except
    // the touched draw which was read again most recently.
    for (const [index, draw] of draws.entries()) {
      raw
        .prepare(
          'UPDATE readings SET last_accessed_at = $accessedAt WHERE account_id = $accountId AND draw_id = $drawId',
        )
        .run({
          $accountId: accountId,
          $drawId: draw.id,
          $accessedAt: new Date(Date.UTC(2026, 7, 6, 12, 0, 0) - index * 1_000).toISOString(),
        });
    }
    raw
      .prepare(
        'UPDATE readings SET last_accessed_at = $accessedAt WHERE account_id = $accountId AND draw_id = $drawId',
      )
      .run({
        $accountId: accountId,
        $drawId: touchedDraw.id,
        $accessedAt: '2026-08-06T13:00:00.000Z',
      });

    const perRowBytes = (
      raw.prepare('SELECT payload_bytes AS bytes FROM readings LIMIT 1').get() as { bytes: number }
    ).bytes;
    const deleted = await archive.enforceCacheLimit(accountId, {
      maxTotalBytes: perRowBytes * 8,
      protectedNewestCount: 3,
    });

    expect(deleted).toBeGreaterThan(0);
    const remaining = new Set(
      (
        raw
          .prepare('SELECT draw_id AS drawId FROM readings WHERE account_id = $accountId')
          .all({ $accountId: accountId }) as { drawId: string }[]
      ).map((row) => row.drawId),
    );
    for (const protectedDraw of draws.slice(0, 3)) {
      expect(remaining.has(protectedDraw.id)).toBe(true);
    }
    expect(remaining.has(pendingDraw.id)).toBe(true);
    expect(remaining.has(touchedDraw.id)).toBe(true);
    const state = await archive.getSyncState(accountId);
    expect(state.totalPayloadBytes).toBeLessThanOrEqual(perRowBytes * 8);
  });

  it('stops when only protected readings remain even if still above budget', async () => {
    const { archive } = await createStores();
    await archive.saveReadings(accountId, [drawFixture(0), drawFixture(1)]);

    const deleted = await archive.enforceCacheLimit(accountId, {
      maxTotalBytes: 1,
      protectedNewestCount: 200,
    });

    expect(deleted).toBe(0);
    const state = await archive.getSyncState(accountId);
    expect(state.savedReadingCount).toBe(2);
  });
});

describe('account isolation', () => {
  it('purging one account leaves the other account archive intact', async () => {
    const { archive, readings } = await createStores();
    await archive.saveReadings(accountId, [drawFixture(0)]);
    await archive.saveReadings(otherAccountId, [drawFixture(1)]);
    await archive.saveCollectionSummary(accountId, collectionFixture());
    await archive.saveCollectionSummary(otherAccountId, collectionFixture());
    await archive.recordReadingsSyncedAt(accountId, '2026-08-06T10:05:00.000Z');

    await readings.purgeAccount(accountId);

    await expect(archive.loadReadingsPage(accountId, { limit: 10 })).resolves.toEqual([]);
    await expect(archive.loadCollectionSummary(accountId)).resolves.toBeUndefined();
    const state = await archive.getSyncState(accountId);
    expect(state).toEqual({
      readingsSyncedAt: undefined,
      savedReadingCount: 0,
      totalPayloadBytes: 0,
    });
    await expect(archive.loadReadingsPage(otherAccountId, { limit: 10 })).resolves.toHaveLength(1);
    await expect(archive.loadCollectionSummary(otherAccountId)).resolves.toBeDefined();
  });
});
