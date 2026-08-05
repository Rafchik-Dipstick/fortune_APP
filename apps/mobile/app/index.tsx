import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { FortuneIntention } from '@fortuneness/shared-types';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ErrorState } from '@/components/error-state';
import { IntentionSelector } from '@/components/intention-selector';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { spacing } from '@/theme/tokens';

type OracleFixtureState = 'ERROR' | 'LOADING' | 'READY';

export default function OracleScreen() {
  const router = useRouter();
  const { isRegular, oracleCardWidth } = useAdaptiveLayout();
  const [intention, setIntention] = useState<FortuneIntention>('GENERAL');
  const [fixtureState, setFixtureState] = useState<OracleFixtureState>('READY');

  return (
    <Screen>
      <PageHeader
        actions={
          <>
            <AppButton
              compact
              label="Collection"
              onPress={() => {
                router.push('/collection');
              }}
              variant="quiet"
            />
            <AppButton
              compact
              label="Shop"
              onPress={() => {
                router.push('/shop');
              }}
              variant="quiet"
            />
            <AppButton
              compact
              label="Settings"
              onPress={() => {
                router.push('/settings');
              }}
              variant="quiet"
            />
          </>
        }
        eyebrow="Daily ritual"
        title="Oracle"
      />

      <StatusBanner
        message="Static Phase 2 fixture — server state connects in Phase 7."
        title="One free reflection is ready"
      />

      {__DEV__ ? (
        <View accessibilityLabel="Development state preview" style={styles.previewControls}>
          <AppButton
            compact
            label="Ready"
            onPress={() => {
              setFixtureState('READY');
            }}
            variant="quiet"
          />
          <AppButton
            compact
            label="Loading"
            onPress={() => {
              setFixtureState('LOADING');
            }}
            variant="quiet"
          />
          <AppButton
            compact
            label="Error"
            onPress={() => {
              setFixtureState('ERROR');
            }}
            variant="quiet"
          />
        </View>
      ) : null}

      {fixtureState === 'LOADING' ? <LoadingSkeleton /> : null}
      {fixtureState === 'ERROR' ? (
        <ErrorState
          message="The fixture could not load its Oracle state. No allowance was consumed."
          onRetry={() => {
            setFixtureState('READY');
          }}
          title="Oracle is temporarily unavailable"
        />
      ) : null}

      {fixtureState === 'READY' ? (
        <View style={[styles.oracle, isRegular ? styles.oracleRegular : undefined]}>
          <View style={styles.cardColumn}>
            <TarotCard
              face="down"
              onPress={() => {
                router.push('/reveal');
              }}
              width={oracleCardWidth}
            />
            <AppButton
              label="Draw your card"
              onPress={() => {
                router.push('/reveal');
              }}
            />
          </View>

          <Surface style={styles.ritualPanel}>
            <AppText color="gold" variant="caption">
              Set an intention
            </AppText>
            <AppText accessibilityRole="header" variant="headline">
              What would you like to notice today?
            </AppText>
            <AppText color="textMuted">
              Choose a focus or keep General. Your reading offers reflection, not certainty.
            </AppText>
            <IntentionSelector onChange={setIntention} value={intention} />
            <View style={styles.allowance}>
              <AppText variant="label">1 draw available</AppText>
              <AppText color="textMuted" variant="caption">
                Next daily card at 12:00 AM Europe/Kyiv
              </AppText>
            </View>
          </Surface>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  oracle: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingTop: spacing.xl,
  },
  previewControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  oracleRegular: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardColumn: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  ritualPanel: {
    width: '100%',
    maxWidth: 520,
  },
  allowance: {
    gap: spacing.xxs,
    paddingTop: spacing.sm,
  },
});
