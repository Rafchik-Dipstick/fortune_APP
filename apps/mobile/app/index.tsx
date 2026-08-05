import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { FortuneIntention } from '@fortuneness/shared-types';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { IntentionSelector } from '@/components/intention-selector';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { spacing } from '@/theme/tokens';

export default function OracleScreen() {
  const router = useRouter();
  const { isRegular, oracleCardWidth } = useAdaptiveLayout();
  const [intention, setIntention] = useState<FortuneIntention>('GENERAL');

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  oracle: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingTop: spacing.xl,
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
