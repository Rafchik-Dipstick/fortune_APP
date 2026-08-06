import type { CollectionResponse, FortuneHistoryResponse } from '@fortuneness/api-contracts';

import { archiveCacheLimits } from '../local-data/archive-store';

export interface ArchiveSyncStore {
  enforceCacheLimit: (accountId: string) => Promise<number>;
  filterKnownReadingIds: (accountId: string, ids: readonly string[]) => Promise<Set<string>>;
  recordReadingsSyncedAt: (accountId: string, syncedAt: string) => Promise<void>;
  saveCollectionSummary: (accountId: string, response: CollectionResponse) => Promise<void>;
  saveReadings: (accountId: string, draws: FortuneHistoryResponse['items']) => Promise<void>;
}

export interface ArchiveSyncDependencies {
  fetchCollection: (accessToken: string) => Promise<CollectionResponse>;
  fetchHistoryPage: (
    accessToken: string,
    query: { cursor?: string; limit: number },
  ) => Promise<FortuneHistoryResponse>;
  store: ArchiveSyncStore;
}

export interface ArchiveSyncResult {
  syncedAt: string;
  syncedReadingCount: number;
}

/**
 * Refreshes the offline archive baseline: the discovery summary plus the
 * newest readings, newest page first, until the latest-200 target is met, the
 * server archive ends, or a fully known page proves the local cache is already
 * contiguous with the server history.
 */
export class ArchiveSyncController {
  constructor(private readonly dependencies: ArchiveSyncDependencies) {}

  async syncLatest(accountId: string, accessToken: string): Promise<ArchiveSyncResult> {
    const { fetchCollection, fetchHistoryPage, store } = this.dependencies;
    const summary = await fetchCollection(accessToken);
    await store.saveCollectionSummary(accountId, summary);

    let cursor: string | undefined;
    let syncedReadingCount = 0;
    let syncedAt = summary.syncedAt;
    while (syncedReadingCount < archiveCacheLimits.protectedNewestCount) {
      const remaining = archiveCacheLimits.protectedNewestCount - syncedReadingCount;
      const page = await fetchHistoryPage(accessToken, {
        limit: Math.min(100, remaining),
        ...(cursor === undefined ? {} : { cursor }),
      });
      syncedAt = page.syncedAt;
      const ids = page.items.map((item) => item.id);
      const known = await store.filterKnownReadingIds(accountId, ids);
      await store.saveReadings(accountId, page.items);
      syncedReadingCount += page.items.length;
      if (page.nextCursor === null) {
        break;
      }
      if (ids.length > 0 && known.size === ids.length) {
        break;
      }
      cursor = page.nextCursor;
    }

    await store.recordReadingsSyncedAt(accountId, syncedAt);
    await store.enforceCacheLimit(accountId);
    return { syncedAt, syncedReadingCount };
  }
}
