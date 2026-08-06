import {
  apiPaths,
  collectionCardDetailResponseSchema,
  collectionResponseSchema,
  type CollectionCard,
  type CollectionCardDetailResponse,
  type CollectionCardReadingsQuery,
  type CollectionResponse,
} from '@fortuneness/api-contracts';

import { type VersionedKeyRing } from '../config/environment.js';
import { runReadCommittedTransaction } from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { FortuneArchiveError, readArchivePage } from './archive.js';
import { authorizeReadAccess } from './read-authorization.js';
import { serializeFortuneDraw } from './state.js';

type StoredTarotCard = Prisma.TarotCardGetPayload<Record<string, never>>;

interface CardDiscoveryStats {
  firstIssuedAt: Date | null;
  latestIssuedAt: Date | null;
  readingCount: number;
  reversedFirstIssuedAt: Date | null;
  uprightFirstIssuedAt: Date | null;
}

const noDiscoveries: CardDiscoveryStats = {
  firstIssuedAt: null,
  latestIssuedAt: null,
  readingCount: 0,
  reversedFirstIssuedAt: null,
  uprightFirstIssuedAt: null,
};

function serializeCollectionCard(card: StoredTarotCard, stats: CardDiscoveryStats): CollectionCard {
  return {
    key: card.key,
    displayNumber: card.displayNumber,
    name: card.nameEn,
    arcana: card.arcana,
    suit: card.suit,
    rank: card.rank,
    artAltText: card.illustrationAltEn,
    sortOrder: card.sortOrder,
    unlocked: stats.readingCount > 0,
    readingCount: stats.readingCount,
    firstDiscoveredAt: stats.firstIssuedAt?.toISOString() ?? null,
    latestReadingAt: stats.latestIssuedAt?.toISOString() ?? null,
    uprightDiscoveredAt: stats.uprightFirstIssuedAt?.toISOString() ?? null,
    reversedDiscoveredAt: stats.reversedFirstIssuedAt?.toISOString() ?? null,
  };
}

async function loadDiscoveryStats(
  transaction: Prisma.TransactionClient,
  userId: string,
  cardKey?: string,
): Promise<Map<string, CardDiscoveryStats>> {
  const where = { userId, ...(cardKey === undefined ? {} : { cardKey }) };
  const [totals, orientationFirsts] = await Promise.all([
    transaction.fortuneDraw.groupBy({
      by: ['cardKey'],
      where,
      _count: { _all: true },
      _max: { issuedAt: true },
      _min: { issuedAt: true },
    }),
    transaction.fortuneDraw.groupBy({
      by: ['cardKey', 'orientation'],
      where,
      _min: { issuedAt: true },
    }),
  ]);
  const stats = new Map<string, CardDiscoveryStats>();
  for (const total of totals) {
    stats.set(total.cardKey, {
      firstIssuedAt: total._min.issuedAt,
      latestIssuedAt: total._max.issuedAt,
      readingCount: total._count._all,
      reversedFirstIssuedAt: null,
      uprightFirstIssuedAt: null,
    });
  }
  for (const first of orientationFirsts) {
    const entry = stats.get(first.cardKey);
    if (entry === undefined) {
      continue;
    }
    if (first.orientation === 'UPRIGHT') {
      entry.uprightFirstIssuedAt = first._min.issuedAt;
    } else {
      entry.reversedFirstIssuedAt = first._min.issuedAt;
    }
  }
  return stats;
}

export type CollectionErrorCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED' | 'CURSOR_INVALID' | 'NOT_FOUND';

export class CollectionError extends Error {
  readonly code: CollectionErrorCode;

  constructor(code: CollectionErrorCode, cause?: unknown) {
    super(`Collection request failed: ${code}.`, { cause });
    this.name = 'CollectionError';
    this.code = code;
  }
}

export class CollectionService {
  constructor(
    private readonly client: PrismaClient,
    private readonly cursorKeys: VersionedKeyRing,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async summary(authentication: AuthenticationContext): Promise<CollectionResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const now = this.now();
      const access = await authorizeReadAccess(transaction, authentication, now);
      if (!access.authorized) {
        throw new CollectionError(access.code);
      }
      const [cards, stats] = await Promise.all([
        transaction.tarotCard.findMany({ orderBy: { sortOrder: 'asc' } }),
        loadDiscoveryStats(transaction, access.userId),
      ]);
      const serialized = cards.map((card) =>
        serializeCollectionCard(card, stats.get(card.key) ?? noDiscoveries),
      );
      return collectionResponseSchema.parse({
        cards: serialized,
        unlockedCount: serialized.filter((card) => card.unlocked).length,
        totalCount: serialized.length,
        syncedAt: now.toISOString(),
      });
    });
  }

  async card(
    authentication: AuthenticationContext,
    cardKey: string,
    query: CollectionCardReadingsQuery,
  ): Promise<CollectionCardDetailResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const now = this.now();
      const access = await authorizeReadAccess(transaction, authentication, now);
      if (!access.authorized) {
        throw new CollectionError(access.code);
      }
      const card = await transaction.tarotCard.findUnique({ where: { key: cardKey } });
      if (card === null) {
        throw new CollectionError('NOT_FOUND');
      }
      try {
        const [stats, page] = await Promise.all([
          loadDiscoveryStats(transaction, access.userId, card.key),
          readArchivePage(transaction, {
            cursor: query.cursor,
            limit: query.limit,
            scope: {
              filters: { cardKey: card.key },
              keyRing: this.cursorKeys,
              scope: apiPaths.collectionCard,
              userId: access.userId,
            },
            where: { cardKey: card.key, userId: access.userId },
          }),
        ]);
        return collectionCardDetailResponseSchema.parse({
          card: serializeCollectionCard(card, stats.get(card.key) ?? noDiscoveries),
          readings: page.rows.map(serializeFortuneDraw),
          nextCursor: page.nextCursor,
          syncedAt: now.toISOString(),
        });
      } catch (error) {
        if (error instanceof FortuneArchiveError && error.code === 'CURSOR_INVALID') {
          throw new CollectionError('CURSOR_INVALID', error);
        }
        throw error;
      }
    });
  }
}
