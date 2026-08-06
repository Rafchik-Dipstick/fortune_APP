import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ErrorState } from '@/components/error-state';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { formatReadingDate } from '@/components/reading-row';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { MobileApiError } from '@/auth/api-client';
import { useReadingDetail } from '@/fortune/archive-data';
import { intentionLabels, orientationLabels } from '@/fortune/archive-filters';
import { deckIllustrations, suitSymbol } from '@/fortune/deck-art';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { spacing } from '@/theme/tokens';

const allowanceLabels = {
  FREE_DAILY: 'Daily reading',
  SUBSCRIPTION_DAILY: 'Oracle+ daily reading',
  PACK_CREDIT: 'Fortune Pack reading',
} as const;

export default function ReadingDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const drawId = typeof id === 'string' ? id : '';
  const { oracleCardWidth } = useAdaptiveLayout();
  const detailQuery = useReadingDetail(drawId);

  if (detailQuery.isPending) {
    return (
      <Screen readingWidth>
        <PageHeader
          actions={
            <BackButton
              onPress={() => {
                router.back();
              }}
            />
          }
          eyebrow="Archived reading"
          title="Reading"
        />
        <LoadingSkeleton />
      </Screen>
    );
  }
  if (detailQuery.isError) {
    const error = detailQuery.error;
    const notFound = error instanceof MobileApiError && error.code === 'NOT_FOUND';
    const offline = error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE';
    return (
      <Screen readingWidth>
        <PageHeader
          actions={
            <BackButton
              onPress={() => {
                router.back();
              }}
            />
          }
          eyebrow="Archived reading"
          title="Reading"
        />
        <ErrorState
          actionLabel={notFound ? 'Go back' : 'Try again'}
          message={
            notFound
              ? 'This reading does not exist in your archive.'
              : offline
                ? 'This reading is not saved on this device. Reconnect to read it.'
                : 'The reading could not be loaded. It remains safely archived.'
          }
          onRetry={() => {
            if (notFound) {
              router.back();
              return;
            }
            void detailQuery.refetch();
          }}
          title={
            notFound ? 'Not found' : offline ? 'You appear to be offline' : 'Something went adrift'
          }
        />
      </Screen>
    );
  }

  const { draw } = detailQuery.data;
  const cardWidth = Math.min(oracleCardWidth, 300);
  return (
    <Screen readingWidth>
      <PageHeader
        actions={
          <BackButton
            onPress={() => {
              router.back();
            }}
          />
        }
        eyebrow="Archived reading"
        title={draw.cardName}
      />
      <View style={styles.cardHolder}>
        <TarotCard
          face="up"
          faceUp={{
            artAltText: draw.artAltText,
            cardName: draw.cardName,
            ...(deckIllustrations[draw.cardKey] === undefined
              ? {}
              : { illustration: deckIllustrations[draw.cardKey] }),
            number: draw.cardDisplayNumber,
            orientation: draw.orientation,
            suitSymbol: suitSymbol(draw.cardKey),
          }}
          width={cardWidth}
        />
      </View>
      <View style={styles.copy}>
        <AppText color="gold" variant="label">
          {orientationLabels[draw.orientation]}
        </AppText>
        <AppText variant="title">{draw.headline}</AppText>
        <AppText>{draw.message}</AppText>
        <Surface style={styles.action}>
          <AppText color="gold" variant="label">
            Carry this with you
          </AppText>
          <AppText>{draw.action}</AppText>
        </Surface>
        <AppText color="textMuted">{draw.affirmation}</AppText>
      </View>
      <Surface style={styles.info}>
        <AppText color="textMuted" variant="label">
          About this reading
        </AppText>
        <AppText color="textMuted" variant="caption">
          {`${formatReadingDate(draw.issuedAt)} · ${intentionLabels[draw.intention]} · ${
            allowanceLabels[draw.allowanceSource]
          }`}
        </AppText>
      </Surface>
    </Screen>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <AppButton compact label="Back" onPress={onPress} variant="quiet" />;
}

const styles = StyleSheet.create({
  cardHolder: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  copy: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  action: {
    gap: spacing.xxs,
  },
  info: {
    gap: spacing.xxs,
  },
});
