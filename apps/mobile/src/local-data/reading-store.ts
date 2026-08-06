import type { SQLiteDatabase } from 'expo-sqlite';
import { fortuneDrawSchema, type FortuneDraw } from '@fortuneness/api-contracts';

export type PendingRevealStep = 'CARD_REVEALED' | 'CONTENT_REACHABLE' | 'ISSUED';

export interface PendingReveal {
  draw: FortuneDraw;
  step: PendingRevealStep;
}

interface PendingRevealRow {
  payloadJson: string;
  step: PendingRevealStep;
}

export async function initializeReadingDatabase(database: SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
    PRAGMA user_version = 1;
  `);
}

export class AccountReadingStore {
  constructor(private readonly database: SQLiteDatabase) {}

  async savePendingReveal(
    accountId: string,
    draw: FortuneDraw,
    step: PendingRevealStep = 'ISSUED',
  ): Promise<void> {
    const parsedDraw = fortuneDrawSchema.parse(draw);
    const now = new Date().toISOString();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO readings (
          account_id, draw_id, payload_json, issued_at, viewed_at, updated_at
        ) VALUES ($accountId, $drawId, $payloadJson, $issuedAt, $viewedAt, $updatedAt)
        ON CONFLICT (account_id, draw_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          viewed_at = excluded.viewed_at,
          updated_at = excluded.updated_at`,
        {
          $accountId: accountId,
          $drawId: parsedDraw.id,
          $payloadJson: JSON.stringify(parsedDraw),
          $issuedAt: parsedDraw.issuedAt,
          $viewedAt: parsedDraw.viewedAt,
          $updatedAt: now,
        },
      );
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
    });
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
    await this.database.runAsync(
      `UPDATE pending_reveals
       SET step = $step, updated_at = $updatedAt
       WHERE account_id = $accountId AND draw_id = $drawId`,
      {
        $accountId: accountId,
        $drawId: drawId,
        $step: step,
        $updatedAt: new Date().toISOString(),
      },
    );
  }

  async completeReveal(accountId: string, draw: FortuneDraw): Promise<void> {
    const parsedDraw = fortuneDrawSchema.parse(draw);
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE readings
         SET payload_json = $payloadJson, viewed_at = $viewedAt, updated_at = $updatedAt
         WHERE account_id = $accountId AND draw_id = $drawId`,
        {
          $accountId: accountId,
          $drawId: parsedDraw.id,
          $payloadJson: JSON.stringify(parsedDraw),
          $viewedAt: parsedDraw.viewedAt,
          $updatedAt: new Date().toISOString(),
        },
      );
      await transaction.runAsync(
        'DELETE FROM pending_reveals WHERE account_id = $accountId AND draw_id = $drawId',
        { $accountId: accountId, $drawId: parsedDraw.id },
      );
    });
  }

  async discardPendingReveal(accountId: string, drawId: string): Promise<void> {
    await this.database.runAsync(
      'DELETE FROM pending_reveals WHERE account_id = $accountId AND draw_id = $drawId',
      { $accountId: accountId, $drawId: drawId },
    );
  }

  async purgeAccount(accountId: string): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM pending_reveals WHERE account_id = $accountId', {
        $accountId: accountId,
      });
      await transaction.runAsync('DELETE FROM readings WHERE account_id = $accountId', {
        $accountId: accountId,
      });
    });
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
