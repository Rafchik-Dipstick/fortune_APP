import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { FortuneDraw } from '@fortuneness/api-contracts';

import { intentionLabels, orientationLabels } from '@/fortune/archive-filters';
import { spacing } from '@/theme/tokens';

import { AppText } from './app-text';
import { Surface } from './surface';

export function formatReadingDate(issuedAt: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(issuedAt));
  } catch {
    return issuedAt;
  }
}

export function ReadingRow({
  reading,
  showCardName = true,
}: {
  reading: FortuneDraw;
  showCardName?: boolean;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityHint="Opens the full saved reading."
      accessibilityLabel={`${reading.cardName}, ${orientationLabels[reading.orientation]}, ${
        intentionLabels[reading.intention]
      }, ${formatReadingDate(reading.issuedAt)}.`}
      accessibilityRole="button"
      onPress={() => {
        router.push({ pathname: '/reading/[id]', params: { id: reading.id } });
      }}
    >
      <Surface style={styles.row}>
        <AppText color="gold" variant="caption">
          {`${formatReadingDate(reading.issuedAt)} · ${intentionLabels[reading.intention]} · ${
            orientationLabels[reading.orientation]
          }`}
        </AppText>
        <AppText variant="headline">{reading.headline}</AppText>
        {showCardName ? (
          <AppText color="textMuted" variant="caption">
            {reading.cardName}
          </AppText>
        ) : null}
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xxs,
  },
});
