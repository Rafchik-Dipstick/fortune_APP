import { useEffect, useRef } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CollectionCard, CollectionResponse, FortuneDraw } from '@fortuneness/api-contracts';

import {
  getCollection,
  getCollectionCard,
  getFortuneDetail,
  getFortuneHistory,
  MobileApiError,
} from '../auth/api-client';
import { useAuthentication } from '../auth/authentication';
import { type AuthenticatedMobileSession } from '../auth/authentication-coordinator';
import {
  type ArchivePageBoundary,
  type ArchiveReadingFilters,
  type ArchiveSyncState,
} from '../local-data/archive-store';
import { useLocalData } from '../local-data/local-data';
import { ArchiveSyncController } from './archive-sync';

const pageSize = 30;

export const collectionSummaryQueryKey = (accountId: string) =>
  ['collection', 'summary', accountId] as const;
export const readingsArchiveQueryKey = (accountId: string, filters: ArchiveReadingFilters) =>
  ['fortune', 'history', accountId, filters] as const;
export const collectionCardQueryKey = (accountId: string, cardKey: string) =>
  ['collection', 'card', accountId, cardKey] as const;
export const readingDetailQueryKey = (accountId: string, drawId: string) =>
  ['fortune', 'reading', accountId, drawId] as const;
export const archiveSyncStateQueryKey = (accountId: string) =>
  ['archive', 'sync-state', accountId] as const;

export type ArchivePageParam =
  { cursor: string; kind: 'server' } | { before: ArchivePageBoundary; kind: 'local' };

export interface ArchiveReadingsPage {
  items: FortuneDraw[];
  next: ArchivePageParam | null;
  source: 'cache' | 'server';
  syncedAt: string | null;
}

export interface CollectionSummaryResult {
  response: CollectionResponse;
  source: 'cache' | 'server';
  syncedAt: string;
}

export interface CardDetailPage {
  card: CollectionCard;
  next: ArchivePageParam | null;
  readings: FortuneDraw[];
  source: 'cache' | 'server';
}

export interface ReadingDetailResult {
  draw: FortuneDraw;
  source: 'cache' | 'server';
}

function isOfflineError(error: unknown): boolean {
  return error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE';
}

function useArchiveSession(): { accountId: string; session: AuthenticatedMobileSession } {
  const authentication = useAuthentication();
  if (authentication.phase !== 'AUTHENTICATED' || authentication.session === undefined) {
    throw new Error('Archive data hooks require an authenticated session.');
  }
  return { accountId: authentication.session.user.id, session: authentication.session };
}

function localNext(items: readonly FortuneDraw[]): ArchivePageParam | null {
  const last = items.at(-1);
  if (last === undefined || items.length < pageSize) {
    return null;
  }
  return { before: { drawId: last.id, issuedAt: last.issuedAt }, kind: 'local' };
}

export function useCollectionSummary(): UseQueryResult<CollectionSummaryResult> {
  const { accountId, session } = useArchiveSession();
  const { archiveStore } = useLocalData();
  return useQuery({
    queryKey: collectionSummaryQueryKey(accountId),
    queryFn: async (): Promise<CollectionSummaryResult> => {
      try {
        const response = await getCollection(session.accessToken);
        await archiveStore.saveCollectionSummary(accountId, response);
        return { response, source: 'server', syncedAt: response.syncedAt };
      } catch (error) {
        if (!isOfflineError(error)) {
          throw error;
        }
        const cached = await archiveStore.loadCollectionSummary(accountId);
        if (cached === undefined) {
          throw error;
        }
        return { response: cached.response, source: 'cache', syncedAt: cached.storedAt };
      }
    },
  });
}

export function useReadingsArchive(
  filters: ArchiveReadingFilters,
): UseInfiniteQueryResult<InfiniteData<ArchiveReadingsPage>> {
  const { accountId, session } = useArchiveSession();
  const { archiveStore } = useLocalData();
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: readingsArchiveQueryKey(accountId, filters),
    initialPageParam: undefined as ArchivePageParam | undefined,
    getNextPageParam: (lastPage: ArchiveReadingsPage) => lastPage.next ?? undefined,
    queryFn: async ({ pageParam }): Promise<ArchiveReadingsPage> => {
      if (pageParam?.kind === 'local') {
        const items = await archiveStore.loadReadingsPage(accountId, {
          before: pageParam.before,
          filters,
          limit: pageSize,
        });
        return { items, next: localNext(items), source: 'cache', syncedAt: null };
      }
      try {
        const page = await getFortuneHistory(session.accessToken, {
          ...filters,
          limit: pageSize,
          ...(pageParam === undefined ? {} : { cursor: pageParam.cursor }),
        });
        await archiveStore.saveReadings(accountId, page.items);
        if (pageParam === undefined) {
          await archiveStore.recordReadingsSyncedAt(accountId, page.syncedAt);
        }
        await archiveStore.enforceCacheLimit(accountId);
        void queryClient.invalidateQueries({ queryKey: archiveSyncStateQueryKey(accountId) });
        return {
          items: page.items,
          next: page.nextCursor === null ? null : { cursor: page.nextCursor, kind: 'server' },
          source: 'server',
          syncedAt: page.syncedAt,
        };
      } catch (error) {
        if (pageParam !== undefined || !isOfflineError(error)) {
          throw error;
        }
        const items = await archiveStore.loadReadingsPage(accountId, {
          filters,
          limit: pageSize,
        });
        const state = await archiveStore.getSyncState(accountId);
        return {
          items,
          next: localNext(items),
          source: 'cache',
          syncedAt: state.readingsSyncedAt ?? null,
        };
      }
    },
  });
}

export function useCollectionCardDetail(
  cardKey: string,
): UseInfiniteQueryResult<InfiniteData<CardDetailPage>> {
  const { accountId, session } = useArchiveSession();
  const { archiveStore } = useLocalData();
  return useInfiniteQuery({
    queryKey: collectionCardQueryKey(accountId, cardKey),
    initialPageParam: undefined as ArchivePageParam | undefined,
    getNextPageParam: (lastPage: CardDetailPage) => lastPage.next ?? undefined,
    queryFn: async ({ pageParam }): Promise<CardDetailPage> => {
      if (pageParam?.kind === 'local') {
        const cached = await archiveStore.loadCollectionSummary(accountId);
        const card = cached?.response.cards.find((entry) => entry.key === cardKey);
        if (card === undefined) {
          throw new Error('The cached collection no longer contains this card.');
        }
        const readings = await archiveStore.loadReadingsPage(accountId, {
          before: pageParam.before,
          filters: { cardKey },
          limit: pageSize,
        });
        return { card, next: localNext(readings), readings, source: 'cache' };
      }
      try {
        const page = await getCollectionCard(session.accessToken, cardKey, {
          limit: pageSize,
          ...(pageParam === undefined ? {} : { cursor: pageParam.cursor }),
        });
        await archiveStore.saveReadings(accountId, page.readings);
        await archiveStore.enforceCacheLimit(accountId);
        return {
          card: page.card,
          next: page.nextCursor === null ? null : { cursor: page.nextCursor, kind: 'server' },
          readings: page.readings,
          source: 'server',
        };
      } catch (error) {
        if (pageParam !== undefined || !isOfflineError(error)) {
          throw error;
        }
        const cached = await archiveStore.loadCollectionSummary(accountId);
        const card = cached?.response.cards.find((entry) => entry.key === cardKey);
        if (card === undefined) {
          throw error;
        }
        const readings = await archiveStore.loadReadingsPage(accountId, {
          filters: { cardKey },
          limit: pageSize,
        });
        return { card, next: localNext(readings), readings, source: 'cache' };
      }
    },
  });
}

export function useReadingDetail(drawId: string): UseQueryResult<ReadingDetailResult> {
  const { accountId, session } = useArchiveSession();
  const { archiveStore } = useLocalData();
  return useQuery({
    queryKey: readingDetailQueryKey(accountId, drawId),
    queryFn: async (): Promise<ReadingDetailResult> => {
      const local = await archiveStore.loadReading(accountId, drawId);
      if (local !== undefined) {
        return { draw: local, source: 'cache' };
      }
      const detail = await getFortuneDetail(session.accessToken, drawId);
      await archiveStore.saveReadings(accountId, [detail.draw]);
      return { draw: detail.draw, source: 'server' };
    },
  });
}

export function useArchiveSyncState(): UseQueryResult<ArchiveSyncState> {
  const { accountId } = useArchiveSession();
  const { archiveStore } = useLocalData();
  return useQuery({
    queryKey: archiveSyncStateQueryKey(accountId),
    queryFn: () => archiveStore.getSyncState(accountId),
  });
}

/**
 * Refreshes the offline baseline (discovery summary plus latest-200 readings)
 * once per authenticated account. Failure is quiet: the archive screens keep
 * serving the persisted scope and label it with the last successful sync.
 */
export function useArchiveBaselineSync(): void {
  const { accountId, session } = useArchiveSession();
  const { archiveStore } = useLocalData();
  const queryClient = useQueryClient();
  const syncedAccountId = useRef<string | undefined>(undefined);
  const accessTokenRef = useRef(session.accessToken);
  accessTokenRef.current = session.accessToken;

  useEffect(() => {
    if (syncedAccountId.current === accountId) {
      return;
    }
    syncedAccountId.current = accountId;
    const controller = new ArchiveSyncController({
      fetchCollection: getCollection,
      fetchHistoryPage: (accessToken, query) => getFortuneHistory(accessToken, query),
      store: archiveStore,
    });
    void controller
      .syncLatest(accountId, accessTokenRef.current)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: archiveSyncStateQueryKey(accountId) });
      })
      .catch(() => {
        // Offline or transient failure: cached labels already say how fresh the data is.
      });
  }, [accountId, archiveStore, queryClient]);
}
