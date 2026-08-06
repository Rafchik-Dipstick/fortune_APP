import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CollectionCard } from '@fortuneness/api-contracts';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ErrorState } from '@/components/error-state';
import { ListScreen } from '@/components/list-screen';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { formatReadingDate, ReadingRow } from '@/components/reading-row';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { MobileApiError } from '@/auth/api-client';
import { useCollectionCardDetail } from '@/fortune/archive-data';
import { deckIllustrations, suitSymbol } from '@/fortune/deck-art';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { colors, layout, spacing } from '@/theme/tokens';

function discoveryLine(card: CollectionCard): string {
  if (!card.unlocked || card.firstDiscoveredAt === null) {
    return 'This card has not yet appeared in your readings.';
  }
  const parts = [`First discovered ${formatReadingDate(card.firstDiscoveredAt)}`];
  if (card.uprightDiscoveredAt !== null) {
    parts.push(`upright since ${formatReadingDate(card.uprightDiscoveredAt)}`);
  }
  if (card.reversedDiscoveredAt !== null) {
    parts.push(`reversed since ${formatReadingDate(card.reversedDiscoveredAt)}`);
  }
  return `${parts.join(' · ')}.`;
}

export default function CardDetailScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const cardKey = typeof key === 'string' ? key : '';
  const { gutter, oracleCardWidth, width } = useAdaptiveLayout();
  const detailQuery = useCollectionCardDetail(cardKey);
  const contentPadding = Math.max(gutter, (width - layout.readingMax) / 2);

  const pages = detailQuery.data?.pages;
  const readings = useMemo(() => (pages ?? []).flatMap((page) => page.readings), [pages]);
  const card = pages?.[0]?.card;
  const offline = pages?.[0]?.source === 'cache';
  const cardWidth = Math.min(oracleCardWidth, 280);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  if (detailQuery.isPending) {
    return (
      <ListScreen>
        <View style={[styles.stateContainer, { paddingHorizontal: contentPadding }]}>
          <PageHeader
            actions={
              <BackButton
                onPress={() => {
                  router.back();
                }}
              />
            }
            eyebrow="Collection"
            title="Card"
          />
          <LoadingSkeleton />
        </View>
      </ListScreen>
    );
  }
  if (card === undefined) {
    const error = detailQuery.error;
    const notFound = error instanceof MobileApiError && error.code === 'NOT_FOUND';
    const isOffline = error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE';
    return (
      <ListScreen>
        <View style={[styles.stateContainer, { paddingHorizontal: contentPadding }]}>
          <PageHeader
            actions={
              <BackButton
                onPress={() => {
                  router.back();
                }}
              />
            }
            eyebrow="Collection"
            title="Card"
          />
          <ErrorState
            actionLabel={notFound ? 'Go back' : 'Try again'}
            message={
              notFound
                ? 'This card is not part of the Fortuneness deck.'
                : isOffline
                  ? 'This card needs one online visit before it can be browsed offline.'
                  : 'The card could not be loaded. Your discoveries are safe.'
            }
            onRetry={() => {
              if (notFound) {
                router.back();
                return;
              }
              void detailQuery.refetch();
            }}
            title={
              notFound
                ? 'Unknown card'
                : isOffline
                  ? 'You appear to be offline'
                  : 'Something went adrift'
            }
          />
        </View>
      </ListScreen>
    );
  }

  const header = (
    <View style={styles.headerBlock}>
      <PageHeader
        actions={
          <BackButton
            onPress={() => {
              router.back();
            }}
          />
        }
        eyebrow={card.arcana === 'MAJOR' ? 'Major Arcana' : 'Minor Arcana'}
        title={card.unlocked ? card.name : 'Not yet discovered'}
      />
      <View style={styles.cardHolder}>
        <TarotCard
          accessibilityLabel={
            card.unlocked
              ? `${card.name}. ${card.artAltText}`
              : 'Not yet discovered. The card back keeps its secret.'
          }
          face={card.unlocked ? 'up' : 'down'}
          width={cardWidth}
          {...(card.unlocked
            ? {
                faceUp: {
                  artAltText: card.artAltText,
                  cardName: card.name,
                  ...(deckIllustrations[card.key] === undefined
                    ? {}
                    : { illustration: deckIllustrations[card.key] }),
                  number: card.displayNumber,
                  orientation: 'UPRIGHT' as const,
                  suitSymbol: suitSymbol(card.key),
                },
              }
            : {})}
        />
      </View>
      <Surface style={styles.summary}>
        <AppText variant="headline">
          {card.readingCount === 1
            ? '1 archived reading'
            : `${String(card.readingCount)} archived readings`}
        </AppText>
        <AppText color="textMuted">{discoveryLine(card)}</AppText>
      </Surface>
      {offline ? (
        <StatusBanner
          message="Showing the readings saved on this device for this card."
          title="Offline"
        />
      ) : null}
    </View>
  );

  return (
    <ListScreen>
      <FlatList
        accessibilityLabel={`Readings for ${card.unlocked ? card.name : 'an undiscovered card'}`}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: contentPadding }]}
        data={readings}
        initialNumToRender={10}
        keyExtractor={(reading) => reading.id}
        ListEmptyComponent={
          card.unlocked ? null : (
            <Surface>
              <AppText color="textMuted">
                Draw fortunes on the Oracle page; when this card appears, every reading of it will
                be archived here.
              </AppText>
            </Surface>
          )
        }
        ListFooterComponent={
          detailQuery.isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator />
              <AppText color="textMuted" variant="caption">
                Loading older readings…
              </AppText>
            </View>
          ) : detailQuery.isError ? (
            <View style={styles.footer}>
              <AppText accessibilityLiveRegion="polite" color="danger" variant="caption">
                Older readings could not be loaded.
              </AppText>
              <AppButton
                compact
                label="Try again"
                onPress={() => {
                  if (detailQuery.hasNextPage) {
                    void detailQuery.fetchNextPage();
                    return;
                  }
                  void detailQuery.refetch();
                }}
                variant="secondary"
              />
            </View>
          ) : null
        }
        ListHeaderComponent={header}
        onEndReached={() => {
          if (detailQuery.hasNextPage && !detailQuery.isFetchingNextPage) {
            void detailQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setManualRefreshing(true);
              void detailQuery.refetch().then(() => {
                setManualRefreshing(false);
              });
            }}
            refreshing={manualRefreshing}
            tintColor={colors.goldMuted}
          />
        }
        renderItem={({ item }) => <ReadingRow reading={item} showCardName={false} />}
      />
    </ListScreen>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <AppButton compact label="Back" onPress={onPress} variant="quiet" />;
}

const styles = StyleSheet.create({
  stateContainer: {
    flex: 1,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  cardHolder: {
    alignItems: 'center',
  },
  summary: {
    gap: spacing.xxs,
  },
  listContent: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
});
