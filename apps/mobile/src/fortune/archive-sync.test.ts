import { describe, expect, it, vi } from 'vitest';
import type { CollectionResponse, FortuneDraw } from '@fortuneness/api-contracts';

import { ArchiveSyncController, type ArchiveSyncStore } from './archive-sync';

const accountId = '26087e7e-0613-49fd-bd8f-e52dc58652a9';
const accessToken = 'access-token';

const summary = {
  cards: [],
  unlockedCount: 0,
  totalCount: 78,
  syncedAt: '2026-08-06T10:00:00.000Z',
} as unknown as CollectionResponse;

function draw(index: number): FortuneDraw {
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
  };
}

function createStore(
  known: readonly string[] = [],
  options: { priorSyncedAt?: string } = {},
): ArchiveSyncStore & {
  bumpPurgeEpoch: () => void;
  enforceCacheLimit: ReturnType<typeof vi.fn>;
  recordReadingsSyncedAt: ReturnType<typeof vi.fn>;
  saveCollectionSummary: ReturnType<typeof vi.fn>;
  saveReadings: ReturnType<typeof vi.fn>;
} {
  const knownIds = new Set(known);
  let epoch = 0;
  return {
    bumpPurgeEpoch: () => {
      epoch += 1;
    },
    enforceCacheLimit: vi.fn().mockResolvedValue(0),
    filterKnownReadingIds: vi.fn((_account: string, ids: readonly string[]) =>
      Promise.resolve(new Set(ids.filter((id) => knownIds.has(id)))),
    ),
    getPurgeEpoch: () => epoch,
    getSyncState: vi.fn().mockResolvedValue({
      readingsSyncedAt: options.priorSyncedAt,
      savedReadingCount: known.length,
      totalPayloadBytes: 0,
    }),
    recordReadingsSyncedAt: vi.fn().mockResolvedValue(undefined),
    saveCollectionSummary: vi.fn().mockResolvedValue(undefined),
    saveReadings: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ArchiveSyncController', () => {
  it('refreshes the summary then saves newest pages up to the latest-200 target', async () => {
    const store = createStore();
    const pageOne = Array.from({ length: 100 }, (_, index) => draw(index));
    const pageTwo = Array.from({ length: 100 }, (_, index) => draw(index + 100));
    const fetchHistoryPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: pageOne,
        nextCursor: 'v1.cursor-one.signature',
        syncedAt: '2026-08-06T10:00:01.000Z',
      })
      .mockResolvedValueOnce({
        items: pageTwo,
        nextCursor: 'v1.cursor-two.signature',
        syncedAt: '2026-08-06T10:00:02.000Z',
      });
    const controller = new ArchiveSyncController({
      fetchCollection: vi.fn().mockResolvedValue(summary),
      fetchHistoryPage,
      store,
    });

    const result = await controller.syncLatest(accountId, accessToken);

    expect(result).toEqual({
      aborted: false,
      syncedAt: '2026-08-06T10:00:02.000Z',
      syncedReadingCount: 200,
    });
    expect(store.saveCollectionSummary).toHaveBeenCalledWith(accountId, summary);
    expect(fetchHistoryPage).toHaveBeenNthCalledWith(1, accessToken, { limit: 100 });
    expect(fetchHistoryPage).toHaveBeenNthCalledWith(2, accessToken, {
      cursor: 'v1.cursor-one.signature',
      limit: 100,
    });
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2);
    expect(store.recordReadingsSyncedAt).toHaveBeenCalledWith(
      accountId,
      '2026-08-06T10:00:02.000Z',
    );
    expect(store.enforceCacheLimit).toHaveBeenCalledWith(accountId);
  });

  it('stops when the server archive ends before the target', async () => {
    const store = createStore();
    const items = Array.from({ length: 12 }, (_, index) => draw(index));
    const controller = new ArchiveSyncController({
      fetchCollection: vi.fn().mockResolvedValue(summary),
      fetchHistoryPage: vi
        .fn()
        .mockResolvedValue({ items, nextCursor: null, syncedAt: '2026-08-06T10:00:01.000Z' }),
      store,
    });

    const result = await controller.syncLatest(accountId, accessToken);

    expect(result.syncedReadingCount).toBe(12);
    expect(store.saveReadings).toHaveBeenCalledTimes(1);
  });

  it('stops early on a fully known page once a baseline sync has completed before', async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) => draw(index));
    const store = createStore(
      pageOne.map((item) => item.id),
      { priorSyncedAt: '2026-08-05T10:00:00.000Z' },
    );
    const fetchHistoryPage = vi.fn().mockResolvedValue({
      items: pageOne,
      nextCursor: 'v1.cursor-one.signature',
      syncedAt: '2026-08-06T10:00:01.000Z',
    });
    const controller = new ArchiveSyncController({
      fetchCollection: vi.fn().mockResolvedValue(summary),
      fetchHistoryPage,
      store,
    });

    const result = await controller.syncLatest(accountId, accessToken);

    expect(result.syncedReadingCount).toBe(100);
    expect(fetchHistoryPage).toHaveBeenCalledTimes(1);
    expect(store.saveReadings).toHaveBeenCalledTimes(1);
  });

  it('keeps paging past a fully known page when no baseline sync ever completed', async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) => draw(index));
    const pageTwo = Array.from({ length: 100 }, (_, index) => draw(index + 100));
    const store = createStore(pageOne.map((item) => item.id));
    const fetchHistoryPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: pageOne,
        nextCursor: 'v1.cursor-one.signature',
        syncedAt: '2026-08-06T10:00:01.000Z',
      })
      .mockResolvedValueOnce({
        items: pageTwo,
        nextCursor: null,
        syncedAt: '2026-08-06T10:00:02.000Z',
      });
    const controller = new ArchiveSyncController({
      fetchCollection: vi.fn().mockResolvedValue(summary),
      fetchHistoryPage,
      store,
    });

    const result = await controller.syncLatest(accountId, accessToken);

    expect(result).toEqual({
      aborted: false,
      syncedAt: '2026-08-06T10:00:02.000Z',
      syncedReadingCount: 200,
    });
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2);
    expect(store.recordReadingsSyncedAt).toHaveBeenCalledWith(
      accountId,
      '2026-08-06T10:00:02.000Z',
    );
  });

  it('aborts without writing when the account is purged mid-sync', async () => {
    const store = createStore();
    const items = Array.from({ length: 10 }, (_, index) => draw(index));
    const fetchHistoryPage = vi.fn().mockImplementation(() => {
      store.bumpPurgeEpoch();
      return Promise.resolve({ items, nextCursor: null, syncedAt: '2026-08-06T10:00:01.000Z' });
    });
    const controller = new ArchiveSyncController({
      fetchCollection: vi.fn().mockResolvedValue(summary),
      fetchHistoryPage,
      store,
    });

    const result = await controller.syncLatest(accountId, accessToken);

    expect(result.aborted).toBe(true);
    expect(store.saveReadings).not.toHaveBeenCalled();
    expect(store.recordReadingsSyncedAt).not.toHaveBeenCalled();
    expect(store.enforceCacheLimit).not.toHaveBeenCalled();
  });

  it('propagates fetch failures without recording a successful sync', async () => {
    const store = createStore();
    const controller = new ArchiveSyncController({
      fetchCollection: vi.fn().mockRejectedValue(new Error('offline')),
      fetchHistoryPage: vi.fn(),
      store,
    });

    await expect(controller.syncLatest(accountId, accessToken)).rejects.toThrow('offline');
    expect(store.recordReadingsSyncedAt).not.toHaveBeenCalled();
    expect(store.saveCollectionSummary).not.toHaveBeenCalled();
  });
});
