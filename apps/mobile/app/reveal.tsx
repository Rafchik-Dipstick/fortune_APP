import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { FortuneDraw } from '@fortuneness/api-contracts';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ErrorState } from '@/components/error-state';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { RevealCardSequence } from '@/components/reveal-card-sequence';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { deckIllustrations, suitSymbol } from '@/fortune/deck-art';
import { useFortuneRitual } from '@/fortune/fortune-ritual';
import type { PendingReveal } from '@/local-data/reading-store';
import { usePerformance } from '@/observability/performance-provider';
import { useAdaptiveLayout } from '@/theme/adaptive';

const intentionLabels = {
  GENERAL: 'General',
  LOVE: 'Love',
  WORK: 'Work',
  GROWTH: 'Growth',
} as const;

const allowanceLabels = {
  FREE_DAILY: 'Daily reading',
  SUBSCRIPTION_DAILY: 'Oracle+ daily reading',
  PACK_CREDIT: 'Fortune Pack reading',
} as const;

function formatReadingDate(draw: FortuneDraw): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
      new Date(draw.issuedAt),
    );
  } catch {
    return draw.issuedAt;
  }
}

export default function RevealScreen() {
  const router = useRouter();
  const ritual = useFortuneRitual();
  const performance = usePerformance();
  const { oracleCardWidth } = useAdaptiveLayout();
  const [reading, setReading] = useState<PendingReveal>();

  useEffect(() => {
    if (reading === undefined && ritual.pendingReveal !== undefined) {
      setReading(ritual.pendingReveal);
    }
  }, [reading, ritual.pendingReveal]);

  useEffect(() => {
    // A resumed reveal starts past the flip, so only a fresh reveal opens the
    // span. Measuring a resume as if it were a first draw would report a card
    // that was already on screen as an instant one.
    if (reading?.step === 'ISSUED') {
      performance.mark('reveal.opened');
    }
  }, [performance, reading?.step]);

  if (reading === undefined) {
    return (
      <Screen readingWidth>
        {ritual.isStateLoading ? (
          <LoadingSkeleton />
        ) : (
          <ErrorState
            message="There is no saved reading waiting to be revealed."
            onRetry={() => {
              router.replace('/');
            }}
            title="Return to the Oracle"
          />
        )}
      </Screen>
    );
  }

  const draw = reading.draw;
  const acknowledgementAccepted = ritual.acknowledgementAcceptedDrawId === draw.id;
  const acknowledgementCopy = acknowledgementAccepted
    ? 'Added to Collection · Presentation confirmed'
    : ritual.isAcknowledging && ritual.acknowledgementError !== undefined
      ? 'Added to Collection · Reconnecting to confirm presentation'
      : ritual.isAcknowledging
        ? 'Added to Collection · Confirming presentation'
        : ritual.acknowledgementError === undefined
          ? 'Added to Collection'
          : 'Added to Collection · Confirmation will retry from Oracle';

  return (
    <Screen readingWidth>
      <PageHeader
        actions={
          <AppButton
            compact
            label="Close"
            onPress={() => {
              router.replace('/');
            }}
            variant="quiet"
          />
        }
        eyebrow="Your reading"
        title={draw.cardName}
      />

      <RevealCardSequence
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
        initialStep={reading.step}
        onCardRevealed={() => {
          performance.measure('reveal.cardReady', 'reveal.opened');
          void ritual.markCardRevealed(draw.id);
        }}
        onContentReachable={() => {
          performance.measure('reveal.contentReachable', 'reveal.opened');
          performance.clearMark('reveal.opened');
          ritual.acknowledgeContentReachable(draw.id);
        }}
        width={oracleCardWidth}
      >
        <AppText color="gold" variant="caption">
          {intentionLabels[draw.intention]} ·{' '}
          {draw.orientation === 'REVERSED' ? 'Reversed' : 'Upright'}
        </AppText>
        <AppText accessibilityRole="header" variant="title">
          {draw.headline}
        </AppText>
        <AppText color="textMuted">{draw.message}</AppText>

        <Surface>
          <AppText color="gold" variant="label">
            Carry this with you
          </AppText>
          <AppText>{draw.action}</AppText>
        </Surface>

        <Surface>
          <AppText color="gold" variant="label">
            Affirmation
          </AppText>
          <AppText style={styles.affirmation} variant="headline">
            {draw.affirmation}
          </AppText>
        </Surface>

        <Surface>
          <AppText color="gold" variant="label">
            Reading details
          </AppText>
          <AppText color="textMuted" variant="caption">
            {formatReadingDate(draw)} · {intentionLabels[draw.intention]} ·{' '}
            {allowanceLabels[draw.allowanceSource]}
          </AppText>
        </Surface>

        <AppText
          accessibilityLiveRegion="polite"
          color={ritual.acknowledgementError === undefined ? 'textMuted' : 'danger'}
          style={styles.saved}
          variant="caption"
        >
          {acknowledgementCopy}
        </AppText>
        <AppButton
          label="Return to Oracle"
          onPress={() => {
            router.replace('/');
          }}
        />
      </RevealCardSequence>
    </Screen>
  );
}

const styles = StyleSheet.create({
  affirmation: {
    textAlign: 'center',
  },
  saved: {
    textAlign: 'center',
  },
});
