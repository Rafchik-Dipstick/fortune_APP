import type { SQLiteDatabase } from 'expo-sqlite';
import { fortuneDrawSchema, type FortuneDraw } from '@fortuneness/api-contracts';

import { bumpAccountPurgeEpoch } from './purge-epoch';
import { getDatabaseWriteQueue } from './write-queue';

export type PendingRevealStep = 'CARD_REVEALED' | 'CONTENT_REACHABLE' | 'ISSUED';

export interface PendingReveal {
  draw: FortuneDraw;
  step: PendingRevealStep;
}

interface PendingRevealRow {
  payloadJson: string;
  step: PendingRevealStep;
}

const baseSchemaSql = `
  CREATE TABLE IF NOT EXISTS readings (
    account_id TEXT NOT NULL,
    draw_id TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    issued_at TEXT NOT NULL,
    viewed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, draw_id)
  );
  CREATE INDEX IF NOT EXISTS readings_account_issued_idx
    ON readings (account_id, issued_at DESC, draw_id DESC);
  CREATE TABLE IF NOT EXISTS pending_reveals (
    account_id TEXT PRIMARY KEY,
    draw_id TEXT NOT NULL,
    step TEXT NOT NULL CHECK (step IN ('ISSUED', 'CARD_REVEALED', 'CONTENT_REACHABLE')),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (account_id, draw_id)
      REFERENCES readings (account_id, draw_id) ON DELETE CASCADE
  );
`;

const archiveColumnsSql: Readonly<Record<string, string>> = {
  card_key: 'ALTER TABLE readings ADD COLUMN card_key TEXT;',
  intention: 'ALTER TABLE readings ADD COLUMN intention TEXT;',
  orientation: 'ALTER TABLE readings ADD COLUMN orientation TEXT;',
  payload_bytes: 'ALTER TABLE readings ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0;',
  last_accessed_at: 'ALTER TABLE readings ADD COLUMN last_accessed_at TEXT;',
};

const archiveBackfillSql = `
  UPDATE readings SET
    card_key = json_extract(payload_json, '$.cardKey'),
    intention = json_extract(payload_json, '$.intention'),
    orientation = json_extract(payload_json, '$.orientation'),
    payload_bytes = length(CAST(payload_json AS BLOB)),
    last_accessed_at = updated_at
  WHERE card_key IS NULL;
  CREATE INDEX IF NOT EXISTS readings_account_lru_idx
    ON readings (account_id, last_accessed_at ASC);
  CREATE TABLE IF NOT EXISTS collection_summaries (
    account_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    synced_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS archive_sync_state (
    account_id TEXT PRIMARY KEY,
    readings_synced_at TEXT,
    updated_at TEXT NOT NULL
  );
`;

export async function initializeReadingDatabase(database: SQLiteDatabase): Promise<void> {
  await database.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
  );
  const versionRow = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = versionRow?.user_version ?? 0;
  if (version < 1) {
    await database.execAsync(baseSchemaSql);
  }
  if (version < 2) {
    // Column-by-column guards keep the upgrade re-runnable if a previous
    // launch died between an ALTER statement and the version stamp.
    const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(readings)');
    const existing = new Set(columns.map((column) => column.name));
    for (const [column, statement] of Object.entries(archiveColumnsSql)) {
      if (!existing.has(column)) {
        await database.execAsync(statement);
      }
    }
    await database.execAsync(archiveBackfillSql);
  }
  await database.execAsync('PRAGMA user_version = 2;');
}

export function readingColumnValues(draw: FortuneDraw, now: string) {
  return {
    $payloadJson: JSON.stringify(draw),
    $issuedAt: draw.issuedAt,
    $viewedAt: draw.viewedAt,
    $cardKey: draw.cardKey,
    $intention: draw.intention,
    $orientation: draw.orientation,
    $updatedAt: now,
    $lastAccessedAt: now,
  };
}

export const upsertReadingSql = `INSERT INTO readings (
    account_id, draw_id, payload_json, issued_at, viewed_at,
    card_key, intention, orientation, payload_bytes, updated_at, last_accessed_at
  ) VALUES ($accountId, $drawId, $payloadJson, $issuedAt, $viewedAt,
    $cardKey, $intention, $orientation, length(CAST($payloadJson AS BLOB)), $updatedAt, $lastAccessedAt)
  ON CONFLICT (account_id, draw_id) DO UPDATE SET
    payload_json = excluded.payload_json,
    viewed_at = excluded.viewed_at,
    card_key = excluded.card_key,
    intention = excluded.intention,
    orientation = excluded.orientation,
    payload_bytes = excluded.payload_bytes,
    updated_at = excluded.updated_at,
    last_accessed_at = excluded.last_accessed_at`;

export class AccountReadingStore {
  constructor(private readonly database: SQLiteDatabase) {}

  async savePendingReveal(
    accountId: string,
    draw: FortuneDraw,
    step: PendingRevealStep = 'ISSUED',
  ): Promise<void> {
    const parsedDraw = fortuneDrawSchema.parse(draw);
    const now = new Date().toISOString();
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(upsertReadingSql, {
          $accountId: accountId,
          $drawId: parsedDraw.id,
          ...readingColumnValues(parsedDraw, now),
        });
        await transaction.runAsync(
          `INSERT INTO pending_reveals (account_id, draw_id, step, updated_at)
           VALUES ($accountId, $drawId, $step, $updatedAt)
           ON CONFLICT (account_id) DO UPDATE SET
             draw_id = excluded.draw_id,
             step = excluded.step,
             updated_at = excluded.updated_at`,
          {
            $accountId: accountId,
            $drawId: parsedDraw.id,
            $step: step,
            $updatedAt: now,
          },
        );
      }),
    );
  }

  async loadPendingReveal(accountId: string): Promise<PendingReveal | undefined> {
    const row = await this.database.getFirstAsync<PendingRevealRow>(
      `SELECT reading.payload_json AS payloadJson, pending.step AS step
       FROM pending_reveals AS pending
       JOIN readings AS reading
         ON reading.account_id = pending.account_id AND reading.draw_id = pending.draw_id
       WHERE pending.account_id = $accountId`,
      { $accountId: accountId },
    );
    if (row === null) {
      return undefined;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      await this.purgeAccount(accountId);
      return undefined;
    }
    const parsed = fortuneDrawSchema.safeParse(payload);
    if (!parsed.success) {
      await this.purgeAccount(accountId);
      return undefined;
    }
    return { draw: parsed.data, step: row.step };
  }

  async advancePendingReveal(
    accountId: string,
    drawId: string,
    step: Exclude<PendingRevealStep, 'ISSUED'>,
  ): Promise<void> {
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.runAsync(
        `UPDATE pending_reveals
         SET step = $step, updated_at = $updatedAt
         WHERE account_id = $accountId AND draw_id = $drawId`,
        {
          $accountId: accountId,
          $drawId: drawId,
          $step: step,
          $updatedAt: new Date().toISOString(),
        },
      ),
    );
  }

  async completeReveal(accountId: string, draw: FortuneDraw): Promise<void> {
    const parsedDraw = fortuneDrawSchema.parse(draw);
    const now = new Date().toISOString();
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(upsertReadingSql, {
          $accountId: accountId,
          $drawId: parsedDraw.id,
          ...readingColumnValues(parsedDraw, now),
        });
        await transaction.runAsync(
          'DELETE FROM pending_reveals WHERE account_id = $accountId AND draw_id = $drawId',
          { $accountId: accountId, $drawId: parsedDraw.id },
        );
      }),
    );
  }

  async discardPendingReveal(accountId: string, drawId: string): Promise<void> {
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.runAsync(
        'DELETE FROM pending_reveals WHERE account_id = $accountId AND draw_id = $drawId',
        { $accountId: accountId, $drawId: drawId },
      ),
    );
  }

  async purgeAccount(accountId: string): Promise<void> {
    bumpAccountPurgeEpoch(this.database, accountId);
    await getDatabaseWriteQueue(this.database).run(() =>
      this.database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync('DELETE FROM pending_reveals WHERE account_id = $accountId', {
          $accountId: accountId,
        });
        await transaction.runAsync('DELETE FROM readings WHERE account_id = $accountId', {
          $accountId: accountId,
        });
        await transaction.runAsync(
          'DELETE FROM collection_summaries WHERE account_id = $accountId',
          { $accountId: accountId },
        );
        await transaction.runAsync('DELETE FROM archive_sync_state WHERE account_id = $accountId', {
          $accountId: accountId,
        });
      }),
    );
  }
}

export async function reconcilePendingReveal(
  store: AccountReadingStore,
  accountId: string,
  serverDraw: FortuneDraw | null,
): Promise<PendingReveal | undefined> {
  const localPending = await store.loadPendingReveal(accountId);
  if (serverDraw === null) {
    if (localPending !== undefined) {
      await store.discardPendingReveal(accountId, localPending.draw.id);
    }
    return undefined;
  }
  if (localPending?.draw.id === serverDraw.id) {
    return localPending;
  }
  await store.savePendingReveal(accountId, serverDraw);
  return { draw: fortuneDrawSchema.parse(serverDraw), step: 'ISSUED' };
}
