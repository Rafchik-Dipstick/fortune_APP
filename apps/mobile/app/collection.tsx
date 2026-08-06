import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { CollectionCard } from '@fortuneness/api-contracts';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ArchiveFilterSheet } from '@/components/archive-filter-sheet';
import { ErrorState } from '@/components/error-state';
import { ListScreen } from '@/components/list-screen';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { ReadingRow } from '@/components/reading-row';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { MobileApiError } from '@/auth/api-client';
import {
  useArchiveBaselineSync,
  useArchiveSyncState,
  useCollectionSummary,
  useReadingsArchive,
} from '@/fortune/archive-data';
import {
  countActiveFilters,
  defaultArchiveFilterSelection,
  toReadingFilters,
  type ArchiveFilterSelection,
} from '@/fortune/archive-filters';
import { deckIllustrations, suitSymbol } from '@/fortune/deck-art';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { getCollectionGridLayout } from '@/theme/collection-layout';
import { colors, layout, radii, spacing } from '@/theme/tokens';

type CollectionMode = 'deck' | 'readings';

function formatSyncTime(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return 'never';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function deckCardAccessibilityLabel(card: CollectionCard): string {
  if (!card.unlocked) {
    return 'Not yet discovered.';
  }
  const discoveries = [
    card.uprightDiscoveredAt === null ? undefined : 'upright',
    card.reversedDiscoveredAt === null ? undefined : 'reversed',
  ].filter((value): value is string => value !== undefined);
  const readings = card.readingCount === 1 ? '1 reading' : `${String(card.readingCount)} readings`;
  return `${card.name}. Discovered ${discoveries.join(' and ')}. ${readings}.`;
}

export default function CollectionScreen() {
  const router = useRouter();
  const { gutter, width } = useAdaptiveLayout();
  const [mode, setMode] = useState<CollectionMode>('deck');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [selection, setSelection] = useState<ArchiveFilterSelection>(defaultArchiveFilterSelection);
  const filters = useMemo(() => toReadingFilters(selection, new Date()), [selection]);

  useArchiveBaselineSync();
  const summaryQuery = useCollectionSummary();
  const readingsQuery = useReadingsArchive(filters);
  const syncStateQuery = useArchiveSyncState();

  const grid = getCollectionGridLayout(width, gutter);
  const gridWidth = grid.cellWidth * grid.columns + grid.gap * (grid.columns - 1);
  const gridPadding = Math.max(gutter, (width - gridWidth) / 2);
  const readingsPadding = Math.max(gutter, (width - layout.readingMax) / 2);

  const readingPages = readingsQuery.data?.pages;
  const readings = useMemo(
    () => (readingPages ?? []).flatMap((page) => page.items),
    [readingPages],
  );
  const firstPage = readingPages?.[0];
  const offlineReadings = firstPage?.source === 'cache';
  const offlineSummary = summaryQuery.data?.source === 'cache';
  const savedCount = syncStateQuery.data?.savedReadingCount ?? 0;
  const lastSync = firstPage?.syncedAt ?? syncStateQuery.data?.readingsSyncedAt ?? null;
  const activeFilterCount = countActiveFilters(selection);

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const refreshCurrentMode = () => {
    setManualRefreshing(true);
    const refetches =
      mode === 'deck'
        ? [summaryQuery.refetch()]
        : [readingsQuery.refetch(), syncStateQuery.refetch()];
    void Promise.allSettled(refetches).then(() => {
      setManualRefreshing(false);
    });
  };
  const refreshControl = (
    <RefreshControl
      onRefresh={refreshCurrentMode}
      refreshing={manualRefreshing}
      tintColor={colors.goldMuted}
    />
  );

  // The sheet must stay mounted through loading and error renders: a filter
  // change re-keys the query, and unmounting the open modal would close it.
  const filterSheet = (
    <ArchiveFilterSheet
      onChange={setSelection}
      onClose={() => {
        setFilterSheetVisible(false);
      }}
      selection={selection}
      visible={filterSheetVisible}
    />
  );

  const header = (
    <View>
      <PageHeader
        actions={
          <AppButton
            compact
            label="Done"
            onPress={() => {
              router.back();
            }}
            variant="quiet"
          />
        }
        eyebrow="Saved for this account"
        title="Collection"
      />
      <View accessibilityRole="tablist" style={styles.segments}>
        {(['deck', 'readings'] as const).map((item) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === item }}
            key={item}
            onPress={() => {
              setMode(item);
            }}
            style={[styles.segment, mode === item ? styles.segmentSelected : undefined]}
          >
            <AppText color={mode === item ? 'text' : 'textMuted'} variant="label">
              {item === 'deck' ? 'Deck' : 'Readings'}
            </AppText>
          </Pressable>
        ))}
      </View>
      {mode === 'deck' ? (
        <View style={styles.headerBlock}>
          {summaryQuery.data === undefined ? null : (
            <Surface style={styles.progress}>
              <AppText variant="headline">
                {`${String(summaryQuery.data.response.unlockedCount)} / ${String(
                  summaryQuery.data.response.totalCount,
                )} discovered`}
              </AppText>
              <AppText color="textMuted">
                {summaryQuery.data.response.unlockedCount === summaryQuery.data.response.totalCount
                  ? 'Every card in the deck has revealed itself to you.'
                  : 'Upright and reversed discoveries remain visible for the life of the account.'}
              </AppText>
            </Surface>
          )}
          {offlineSummary ? (
            <StatusBanner
              message={`Showing the saved deck summary. Last sync: ${formatSyncTime(
                summaryQuery.data?.syncedAt,
              )}.`}
              title="Offline"
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.headerBlock}>
          <View style={styles.filterRow}>
            <AppButton
              compact
              label={
                activeFilterCount === 0
                  ? 'Filters'
                  : `Filters · ${String(activeFilterCount)} active`
              }
              onPress={() => {
                setFilterSheetVisible(true);
              }}
              variant="secondary"
            />
            {readingsQuery.isFetching && !readingsQuery.isPending ? (
              <AppText color="textMuted" variant="caption">
                Refreshing…
              </AppText>
            ) : null}
          </View>
          {offlineReadings ? (
            <StatusBanner
              message={`Filters cover only the ${String(savedCount)} saved readings on this device. Last sync: ${formatSyncTime(
                lastSync,
              )}.`}
              title="Offline archive"
            />
          ) : null}
        </View>
      )}
    </View>
  );

  if (mode === 'deck') {
    if (summaryQuery.isPending) {
      return (
        <ListScreen>
          <View style={[styles.stateContainer, { paddingHorizontal: gutter }]}>
            {header}
            <LoadingSkeleton />
          </View>
        </ListScreen>
      );
    }
    if (summaryQuery.data === undefined) {
      const offline =
        summaryQuery.error instanceof MobileApiError &&
        summaryQuery.error.code === 'NETWORK_UNAVAILABLE';
      return (
        <ListScreen>
          <View style={[styles.stateContainer, { paddingHorizontal: gutter }]}>
            {header}
            <ErrorState
              message={
                offline
                  ? 'The deck needs one online visit before it can be browsed offline.'
                  : 'The deck could not be loaded. Your discoveries are safe.'
              }
              onRetry={() => {
                void summaryQuery.refetch();
              }}
              title={offline ? 'You appear to be offline' : 'Something went adrift'}
            />
          </View>
        </ListScreen>
      );
    }
    return (
      <ListScreen>
        <FlatList
          key={`deck-${String(grid.columns)}`}
          accessibilityLabel="Tarot deck collection"
          columnWrapperStyle={grid.columns > 1 ? { gap: grid.gap } : undefined}
          contentContainerStyle={[
            styles.listContent,
            { gap: grid.gap, paddingHorizontal: gridPadding },
          ]}
          data={summaryQuery.data.response.cards}
          initialNumToRender={12}
          keyExtractor={(card) => card.key}
          ListHeaderComponent={header}
          numColumns={grid.columns}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={deckCardAccessibilityLabel(item)}
              accessibilityRole="button"
              onPress={() => {
                router.push({ pathname: '/card/[key]', params: { key: item.key } });
              }}
              style={{ width: grid.cellWidth }}
            >
              <TarotCard
                compact
                face={item.unlocked ? 'up' : 'down'}
                width={grid.cellWidth}
                {...(item.unlocked
                  ? {
                      faceUp: {
                        artAltText: item.artAltText,
                        cardName: item.name,
                        ...(deckIllustrations[item.key] === undefined
                          ? {}
                          : { illustration: deckIllustrations[item.key] }),
                        number: item.displayNumber,
                        orientation: 'UPRIGHT' as const,
                        suitSymbol: suitSymbol(item.key),
                      },
                    }
                  : { accessibilityLabel: 'Not yet discovered.' })}
              />
              <AppText color={item.unlocked ? 'text' : 'textMuted'} variant="caption">
                {item.unlocked ? item.name : 'Not yet discovered'}
              </AppText>
            </Pressable>
          )}
        />
      </ListScreen>
    );
  }

  if (readingsQuery.isPending) {
    return (
      <ListScreen>
        <View style={[styles.stateContainer, { paddingHorizontal: gutter }]}>
          {header}
          <LoadingSkeleton />
        </View>
        {filterSheet}
      </ListScreen>
    );
  }
  if (readingsQuery.data === undefined) {
    const offline =
      readingsQuery.error instanceof MobileApiError &&
      readingsQuery.error.code === 'NETWORK_UNAVAILABLE';
    return (
      <ListScreen>
        <View style={[styles.stateContainer, { paddingHorizontal: gutter }]}>
          {header}
          <ErrorState
            message={
              offline
                ? 'No saved readings are available yet. Reconnect once to build the offline archive.'
                : 'Your readings could not be loaded. They remain safely archived.'
            }
            onRetry={() => {
              void readingsQuery.refetch();
            }}
            title={offline ? 'You appear to be offline' : 'Something went adrift'}
          />
        </View>
        {filterSheet}
      </ListScreen>
    );
  }

  return (
    <ListScreen>
      <FlatList
        accessibilityLabel="Reading archive"
        contentContainerStyle={[
          styles.listContent,
          styles.readingList,
          { paddingHorizontal: readingsPadding },
        ]}
        data={readings}
        initialNumToRender={10}
        keyExtractor={(reading) => reading.id}
        ListEmptyComponent={
          <Surface>
            <AppText variant="headline">
              {activeFilterCount > 0
                ? 'No readings match these filters'
                : offlineReadings
                  ? 'No readings are saved on this device yet'
                  : 'No readings yet'}
            </AppText>
            <AppText color="textMuted">
              {activeFilterCount > 0
                ? offlineReadings
                  ? 'Offline filters search only the readings saved on this device.'
                  : 'Try removing a filter to see more of your archive.'
                : offlineReadings
                  ? 'Your archive is safely stored on the server. Reconnect once and your latest readings will be saved to this device.'
                  : 'Draw your first card on the Oracle page and it will be archived here.'}
            </AppText>
          </Surface>
        }
        ListFooterComponent={
          readingsQuery.isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.goldMuted} />
              <AppText color="textMuted" variant="caption">
                Loading older readings…
              </AppText>
            </View>
          ) : readingsQuery.isError ? (
            <View style={styles.footer}>
              <AppText accessibilityLiveRegion="polite" color="danger" variant="caption">
                Older readings could not be loaded.
              </AppText>
              <AppButton
                compact
                label="Try again"
                onPress={() => {
                  if (readingsQuery.hasNextPage) {
                    void readingsQuery.fetchNextPage();
                    return;
                  }
                  void readingsQuery.refetch();
                }}
                variant="secondary"
              />
            </View>
          ) : readings.length > 0 && !readingsQuery.hasNextPage ? (
            <AppText color="textMuted" style={styles.footerNote} variant="caption">
              {offlineReadings
                ? `End of the saved offline archive (${String(savedCount)} readings).`
                : 'The beginning of your archive.'}
            </AppText>
          ) : null
        }
        ListHeaderComponent={header}
        onEndReached={() => {
          if (readingsQuery.hasNextPage && !readingsQuery.isFetchingNextPage) {
            void readingsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.6}
        refreshControl={refreshControl}
        renderItem={({ item }) => <ReadingRow reading={item} />}
      />
      {filterSheet}
    </ListScreen>
  );
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    padding: spacing.xxs,
    marginBottom: spacing.lg,
  },
  segment: {
    minHeight: layout.minimumTouchTarget,
    minWidth: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  segmentSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  progress: {
    gap: spacing.xxs,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  stateContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
  },
  readingList: {
    gap: spacing.md,
  },
  readingRow: {
    gap: spacing.xxs,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  footerNote: {
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
