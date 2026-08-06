import type { SQLiteDatabase } from 'expo-sqlite';
import {
  collectionResponseSchema,
  fortuneDrawSchema,
  type CollectionResponse,
  type FortuneDraw,
  type FortuneIntention,
  type FortuneOrientation,
  type TarotArcana,
  type TarotSuit,
} from '@fortuneness/api-contracts';

import { readingColumnValues, upsertReadingSql } from './reading-store';
import { getDatabaseWriteQueue } from './write-queue';

export const archiveCacheLimits = {
  maxTotalBytes: 50 * 1024 * 1024,
  protectedNewestCount: 200,
} as const;

export interface ArchiveReadingFilters {
  arcana?: TarotArcana;
  cardKey?: string;
  intention?: FortuneIntention;
  issuedFrom?: string;
  issuedTo?: string;
  orientation?: FortuneOrientation;
  suit?: TarotSuit;
}

export interface ArchivePageBoundary {
  drawId: string;
  issuedAt: string;
}

export interface ArchiveSyncState {
  readingsSyncedAt: string | undefined;
  savedReadingCount: number;
  totalPayloadBytes: number;
}

export interface StoredCollectionSummary {
  response: CollectionResponse;
  storedAt: string;
}

interface ReadingRow {
  drawId: string;
  payloadJson: string;
}

function buildFilterClauses(filters: ArchiveReadingFilters): {
  clauses: string[];
  parameters: Record<string, string>;
} {
  const clauses: string[] = [];
  const parameters: Record<string, string> = {};
  if (filters.cardKey !== undefined) {
    clauses.push('card_key = $filterCardKey');
    parameters.$filterCardKey = filters.cardKey;
  }
  if (filters.intention !== undefined) {
    clauses.push('intention = $filterIntention');
    parameters.$filterIntention = filters.intention;
  }
  if (filters.orientation !== undefined) {
    clauses.push('orientation = $filterOrientation');
    parameters.$filterOrientation = filters.orientation;
  }
  if (filters.arcana === 'MAJOR') {
    clauses.push("card_key LIKE 'major-%'");
  } else if (filters.arcana === 'MINOR') {
    clauses.push("card_key NOT LIKE 'major-%'");
  }
  if (filters.suit !== undefined) {
    clauses.push('card_key LIKE $filterSuitPrefix');
    parameters.$filterSuitPrefix = `${filters.suit.toLowerCase()}-%`;
  }
  if (filters.issuedFrom !== undefined) {
    clauses.push('issued_at >= $filterIssuedFrom');
    parameters.$filterIssuedFrom = filters.issuedFrom;
  }
  if (filters.issuedTo !== undefined) {
    clauses.push('issued_at <= $filterIssuedTo');
    parameters.$filterIssuedTo = filters.issuedTo;
  }
  return { clauses, parameters };
}

export class AccountArchiveStore {
  constructor(private readonly database: SQLiteDatabase) {}

  async saveReadings(accountId: string, draws: readonly FortuneDraw[]): Promise<void> {
    if (draws.length === 0) {
      return;
    }
    const parsed = draws.map((draw) => fortuneDrawSchema.parse(draw));
    const now = new Date().toISOString();
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.withExclusiveTransactionAsync(async (transaction) => {
        for (const draw of parsed) {
          await transaction.runAsync(upsertReadingSql, {
            $accountId: accountId,
            $drawId: draw.id,
            ...readingColumnValues(draw, now),
          });
        }
      }),
    );
  }

  async recordReadingsSyncedAt(accountId: string, syncedAt: string): Promise<void> {
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.runAsync(
        `INSERT INTO archive_sync_state (account_id, readings_synced_at, updated_at)
         VALUES ($accountId, $syncedAt, $updatedAt)
         ON CONFLICT (account_id) DO UPDATE SET
           readings_synced_at = excluded.readings_synced_at,
           updated_at = excluded.updated_at`,
        {
          $accountId: accountId,
          $syncedAt: syncedAt,
          $updatedAt: new Date().toISOString(),
        },
      ),
    );
  }

  async getSyncState(accountId: string): Promise<ArchiveSyncState> {
    const [syncRow, totals] = [
      await this.database.getFirstAsync<{ readingsSyncedAt: string | null }>(
        `SELECT readings_synced_at AS readingsSyncedAt
         FROM archive_sync_state WHERE account_id = $accountId`,
        { $accountId: accountId },
      ),
      await this.database.getFirstAsync<{ savedCount: number; totalBytes: number | null }>(
        `SELECT COUNT(*) AS savedCount, SUM(payload_bytes) AS totalBytes
         FROM readings WHERE account_id = $accountId`,
        { $accountId: accountId },
      ),
    ];
    return {
      readingsSyncedAt: syncRow?.readingsSyncedAt ?? undefined,
      savedReadingCount: totals?.savedCount ?? 0,
      totalPayloadBytes: totals?.totalBytes ?? 0,
    };
  }

  async filterKnownReadingIds(accountId: string, ids: readonly string[]): Promise<Set<string>> {
    const known = new Set<string>();
    for (const id of ids) {
      const row = await this.database.getFirstAsync<{ drawId: string }>(
        `SELECT draw_id AS drawId FROM readings
         WHERE account_id = $accountId AND draw_id = $drawId`,
        { $accountId: accountId, $drawId: id },
      );
      if (row !== null) {
        known.add(row.drawId);
      }
    }
    return known;
  }

  async loadReadingsPage(
    accountId: string,
    options: {
      before?: ArchivePageBoundary;
      filters?: ArchiveReadingFilters;
      limit: number;
    },
  ): Promise<FortuneDraw[]> {
    const { clauses, parameters } = buildFilterClauses(options.filters ?? {});
    const conditions = ['account_id = $accountId', ...clauses];
    if (options.before !== undefined) {
      conditions.push(
        '(issued_at < $beforeIssuedAt OR (issued_at = $beforeIssuedAt AND draw_id < $beforeDrawId))',
      );
      parameters.$beforeIssuedAt = options.before.issuedAt;
      parameters.$beforeDrawId = options.before.drawId;
    }
    const rows = await this.database.getAllAsync<ReadingRow>(
      `SELECT draw_id AS drawId, payload_json AS payloadJson
       FROM readings
       WHERE ${conditions.join(' AND ')}
       ORDER BY issued_at DESC, draw_id DESC
       LIMIT $limit`,
      { $accountId: accountId, $limit: options.limit, ...parameters },
    );

    const readings: FortuneDraw[] = [];
    const corruptIds: string[] = [];
    const readIds: string[] = [];
    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payloadJson);
      } catch {
        corruptIds.push(row.drawId);
        continue;
      }
      const parsed = fortuneDrawSchema.safeParse(payload);
      if (!parsed.success) {
        corruptIds.push(row.drawId);
        continue;
      }
      readings.push(parsed.data);
      readIds.push(row.drawId);
    }
    await getDatabaseWriteQueue(this.database).run(async () => {
      const touchedAt = new Date().toISOString();
      for (const drawId of readIds) {
        await this.database.runAsync(
          `UPDATE readings SET last_accessed_at = $touchedAt
           WHERE account_id = $accountId AND draw_id = $drawId`,
          { $accountId: accountId, $drawId: drawId, $touchedAt: touchedAt },
        );
      }
      for (const drawId of corruptIds) {
        await this.database.runAsync(
          'DELETE FROM readings WHERE account_id = $accountId AND draw_id = $drawId',
          { $accountId: accountId, $drawId: drawId },
        );
      }
    });
    return readings;
  }

  async loadReading(accountId: string, drawId: string): Promise<FortuneDraw | undefined> {
    const row = await this.database.getFirstAsync<ReadingRow>(
      `SELECT draw_id AS drawId, payload_json AS payloadJson
       FROM readings WHERE account_id = $accountId AND draw_id = $drawId`,
      { $accountId: accountId, $drawId: drawId },
    );
    if (row === null) {
      return undefined;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      return undefined;
    }
    const parsed = fortuneDrawSchema.safeParse(payload);
    if (!parsed.success) {
      return undefined;
    }
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.runAsync(
        `UPDATE readings SET last_accessed_at = $touchedAt
         WHERE account_id = $accountId AND draw_id = $drawId`,
        { $accountId: accountId, $drawId: drawId, $touchedAt: new Date().toISOString() },
      ),
    );
    return parsed.data;
  }

  async saveCollectionSummary(accountId: string, response: CollectionResponse): Promise<void> {
    const parsed = collectionResponseSchema.parse(response);
    const now = new Date().toISOString();
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.runAsync(
        `INSERT INTO collection_summaries (account_id, payload_json, synced_at, updated_at)
         VALUES ($accountId, $payloadJson, $syncedAt, $updatedAt)
         ON CONFLICT (account_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           synced_at = excluded.synced_at,
           updated_at = excluded.updated_at`,
        {
          $accountId: accountId,
          $payloadJson: JSON.stringify(parsed),
          $syncedAt: parsed.syncedAt,
          $updatedAt: now,
        },
      ),
    );
  }

  async loadCollectionSummary(accountId: string): Promise<StoredCollectionSummary | undefined> {
    const row = await this.database.getFirstAsync<{ payloadJson: string; syncedAt: string }>(
      `SELECT payload_json AS payloadJson, synced_at AS syncedAt
       FROM collection_summaries WHERE account_id = $accountId`,
      { $accountId: accountId },
    );
    if (row === null) {
      return undefined;
    }
    let payload: unknown = undefined;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      // Handled below as a failed parse.
    }
    const parsed = collectionResponseSchema.safeParse(payload);
    if (!parsed.success) {
      await getDatabaseWriteQueue(this.database).run(() =>
        this.database.runAsync('DELETE FROM collection_summaries WHERE account_id = $accountId', {
          $accountId: accountId,
        }),
      );
      return undefined;
    }
    return { response: parsed.data, storedAt: row.syncedAt };
  }

  /**
   * Deletes least-recently-used readings above the account byte budget while
   * always retaining the newest `protectedNewestCount` readings and any draw
   * referenced by the pending reveal.
   */
  async enforceCacheLimit(
    accountId: string,
    limits: { maxTotalBytes: number; protectedNewestCount: number } = archiveCacheLimits,
  ): Promise<number> {
    let deleted = 0;
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.withExclusiveTransactionAsync(async (transaction) => {
        const totals = await transaction.getFirstAsync<{ totalBytes: number | null }>(
          'SELECT SUM(payload_bytes) AS totalBytes FROM readings WHERE account_id = $accountId',
          { $accountId: accountId },
        );
        let bytesToFree = (totals?.totalBytes ?? 0) - limits.maxTotalBytes;
        if (bytesToFree <= 0) {
          return;
        }
        const candidates = await transaction.getAllAsync<{ drawId: string; payloadBytes: number }>(
          `SELECT candidate.draw_id AS drawId, candidate.payload_bytes AS payloadBytes
         FROM readings AS candidate
         WHERE candidate.account_id = $accountId
           AND candidate.draw_id NOT IN (
             SELECT newest.draw_id FROM readings AS newest
             WHERE newest.account_id = $accountId
             ORDER BY newest.issued_at DESC, newest.draw_id DESC
             LIMIT $protectedNewestCount
           )
           AND candidate.draw_id NOT IN (
             SELECT pending.draw_id FROM pending_reveals AS pending
             WHERE pending.account_id = $accountId
           )
         ORDER BY candidate.last_accessed_at ASC, candidate.issued_at ASC`,
          {
            $accountId: accountId,
            $protectedNewestCount: limits.protectedNewestCount,
          },
        );
        for (const candidate of candidates) {
          if (bytesToFree <= 0) {
            break;
          }
          await transaction.runAsync(
            'DELETE FROM readings WHERE account_id = $accountId AND draw_id = $drawId',
            { $accountId: accountId, $drawId: candidate.drawId },
          );
          bytesToFree -= candidate.payloadBytes;
          deleted += 1;
        }
      }),
    );
    return deleted;
  }
}
