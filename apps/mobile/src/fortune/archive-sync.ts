import type { CollectionResponse, FortuneHistoryResponse } from '@fortuneness/api-contracts';

import { archiveCacheLimits, type ArchiveSyncState } from '../local-data/archive-store';

export interface ArchiveSyncStore {
  enforceCacheLimit: (accountId: string) => Promise<number>;
  filterKnownReadingIds: (accountId: string, ids: readonly string[]) => Promise<Set<string>>;
  getPurgeEpoch: (accountId: string) => number;
  getSyncState: (accountId: string) => Promise<ArchiveSyncState>;
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
  aborted: boolean;
  syncedAt: string;
  syncedReadingCount: number;
}

/**
 * Refreshes the offline archive baseline: the discovery summary plus the
 * newest readings, newest page first, until the latest-200 target is met, the
 * server archive ends, or a fully known page proves the local cache is already
 * contiguous with the server history. The run aborts without recording state
 * when the account is purged mid-flight, so a signed-out account's data is
 * never re-inserted.
 */
export class ArchiveSyncController {
  constructor(private readonly dependencies: ArchiveSyncDependencies) {}

  async syncLatest(accountId: string, accessToken: string): Promise<ArchiveSyncResult> {
    const { fetchCollection, fetchHistoryPage, store } = this.dependencies;
    const epoch = store.getPurgeEpoch(accountId);
    const purged = () => store.getPurgeEpoch(accountId) !== epoch;
    // A fully known page only proves the cache is contiguous when an earlier
    // baseline sync completed; after an interrupted first sync the newest page
    // can be fully known with a gap right below it.
    const priorState = await store.getSyncState(accountId);
    const trustKnownPages = priorState.readingsSyncedAt !== undefined;

    const summary = await fetchCollection(accessToken);
    let syncedAt = summary.syncedAt;
    if (purged()) {
      return { aborted: true, syncedAt, syncedReadingCount: 0 };
    }
    await store.saveCollectionSummary(accountId, summary);

    let cursor: string | undefined;
    let syncedReadingCount = 0;
    while (syncedReadingCount < archiveCacheLimits.protectedNewestCount) {
      const remaining = archiveCacheLimits.protectedNewestCount - syncedReadingCount;
      const page = await fetchHistoryPage(accessToken, {
        limit: Math.min(100, remaining),
        ...(cursor === undefined ? {} : { cursor }),
      });
      syncedAt = page.syncedAt;
      const ids = page.items.map((item) => item.id);
      const known = await store.filterKnownReadingIds(accountId, ids);
      if (purged()) {
        return { aborted: true, syncedAt, syncedReadingCount };
      }
      await store.saveReadings(accountId, page.items);
      syncedReadingCount += page.items.length;
      if (page.nextCursor === null) {
        break;
      }
      if (trustKnownPages && ids.length > 0 && known.size === ids.length) {
        break;
      }
      cursor = page.nextCursor;
    }

    if (purged()) {
      return { aborted: true, syncedAt, syncedReadingCount };
    }
    await store.recordReadingsSyncedAt(accountId, syncedAt);
    await store.enforceCacheLimit(accountId);
    return { aborted: false, syncedAt, syncedReadingCount };
  }
}
