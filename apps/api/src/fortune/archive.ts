import {
  apiPaths,
  fortuneDetailResponseSchema,
  fortuneHistoryResponseSchema,
  type FortuneDetailResponse,
  type FortuneHistoryQuery,
  type FortuneHistoryResponse,
} from '@fortuneness/api-contracts';

import { type VersionedKeyRing } from '../config/environment.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import {
  decodeArchiveCursor,
  encodeArchiveCursor,
  type ArchiveCursorScope,
} from './archive-cursor.js';
import { authorizeReadAccess } from './read-authorization.js';
import { serializeFortuneDraw } from './state.js';

export type FortuneArchiveErrorCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED' | 'CURSOR_INVALID' | 'NOT_FOUND';

export class FortuneArchiveError extends Error {
  readonly code: FortuneArchiveErrorCode;

  constructor(code: FortuneArchiveErrorCode) {
    super(`Fortune archive request failed: ${code}.`);
    this.name = 'FortuneArchiveError';
    this.code = code;
  }
}

function historyCursorFilters(query: FortuneHistoryQuery): Record<string, string | undefined> {
  return {
    arcana: query.arcana,
    cardKey: query.cardKey,
    intention: query.intention,
    issuedFrom: query.issuedFrom,
    issuedTo: query.issuedTo,
    orientation: query.orientation,
    suit: query.suit,
  };
}

function buildHistoryWhere(
  userId: string,
  query: FortuneHistoryQuery,
): Prisma.FortuneDrawWhereInput {
  const cardFilter: Prisma.TarotCardWhereInput = {
    ...(query.arcana === undefined ? {} : { arcana: query.arcana }),
    ...(query.suit === undefined ? {} : { suit: query.suit }),
  };
  const issuedRange: Prisma.DateTimeFilter = {
    ...(query.issuedFrom === undefined ? {} : { gte: new Date(query.issuedFrom) }),
    ...(query.issuedTo === undefined ? {} : { lte: new Date(query.issuedTo) }),
  };
  return {
    userId,
    ...(query.cardKey === undefined ? {} : { cardKey: query.cardKey }),
    ...(query.orientation === undefined ? {} : { orientation: query.orientation }),
    ...(query.intention === undefined ? {} : { intention: query.intention }),
    ...(Object.keys(cardFilter).length === 0 ? {} : { card: cardFilter }),
    ...(Object.keys(issuedRange).length === 0 ? {} : { issuedAt: issuedRange }),
  };
}

export interface ArchivePage {
  nextCursor: string | null;
  rows: readonly Prisma.FortuneDrawGetPayload<Record<string, never>>[];
}

export async function readArchivePage(
  transaction: Prisma.TransactionClient,
  options: {
    cursor: string | undefined;
    limit: number;
    scope: ArchiveCursorScope;
    where: Prisma.FortuneDrawWhereInput;
  },
): Promise<ArchivePage> {
  const conditions: Prisma.FortuneDrawWhereInput[] = [options.where];
  if (options.cursor !== undefined) {
    const position = decodeArchiveCursor(options.scope, options.cursor);
    if (position === undefined) {
      throw new FortuneArchiveError('CURSOR_INVALID');
    }
    conditions.push({
      OR: [
        { issuedAt: { lt: position.issuedAt } },
        { id: { lt: position.id }, issuedAt: position.issuedAt },
      ],
    });
  }
  const rows = await transaction.fortuneDraw.findMany({
    where: { AND: conditions },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
  });
  const page = rows.slice(0, options.limit);
  const boundary = page.at(-1);
  const nextCursor =
    rows.length > options.limit && boundary !== undefined
      ? encodeArchiveCursor(options.scope, { id: boundary.id, issuedAt: boundary.issuedAt })
      : null;
  return { nextCursor, rows: page };
}

export class FortuneArchiveService {
  constructor(
    private readonly client: PrismaClient,
    private readonly cursorKeys: VersionedKeyRing,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    authentication: AuthenticationContext,
    query: FortuneHistoryQuery,
  ): Promise<FortuneHistoryResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const now = this.now();
      const access = await authorizeReadAccess(transaction, authentication, now);
      if (!access.authorized) {
        throw new FortuneArchiveError(access.code);
      }
      const scope: ArchiveCursorScope = {
        filters: historyCursorFilters(query),
        keyRing: this.cursorKeys,
        scope: apiPaths.fortunes,
        userId: access.userId,
      };
      const page = await readArchivePage(transaction, {
        cursor: query.cursor,
        limit: query.limit,
        scope,
        where: buildHistoryWhere(access.userId, query),
      });
      return fortuneHistoryResponseSchema.parse({
        items: page.rows.map(serializeFortuneDraw),
        nextCursor: page.nextCursor,
        syncedAt: now.toISOString(),
      });
    });
  }

  async get(authentication: AuthenticationContext, drawId: string): Promise<FortuneDetailResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const access = await authorizeReadAccess(transaction, authentication, this.now());
      if (!access.authorized) {
        throw new FortuneArchiveError(access.code);
      }
      const draw = await transaction.fortuneDraw.findFirst({
        where: { id: drawId, userId: access.userId },
      });
      if (draw === null) {
        throw new FortuneArchiveError('NOT_FOUND');
      }
      return fortuneDetailResponseSchema.parse({ draw: serializeFortuneDraw(draw) });
    });
  }
}
