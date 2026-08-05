import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { RevealCardSequence } from '@/components/reveal-card-sequence';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { sampleReading } from '@/fixtures/vertical-slice';
import { useAdaptiveLayout } from '@/theme/adaptive';

export default function RevealScreen() {
  const router = useRouter();
  const { oracleCardWidth } = useAdaptiveLayout();

  return (
    <Screen readingWidth>
      <PageHeader
        actions={
          <AppButton
            compact
            label="Close"
            onPress={() => {
              router.back();
            }}
            variant="quiet"
          />
        }
        eyebrow="Your reading"
        title="A beginning appears"
      />

      <RevealCardSequence
        faceUp={{
          artAltText: sampleReading.altText,
          cardName: sampleReading.name,
          ...(sampleReading.illustration ? { illustration: sampleReading.illustration } : {}),
          number: sampleReading.number,
          orientation: sampleReading.orientation,
          suitSymbol: sampleReading.suitSymbol,
        }}
        width={oracleCardWidth}
      >
        <AppText color="gold" variant="caption">
          Growth · Upright
        </AppText>
        <AppText accessibilityRole="header" variant="title">
          {sampleReading.headline}
        </AppText>
        <AppText color="textMuted">{sampleReading.message}</AppText>

        <Surface>
          <AppText color="gold" variant="label">
            Carry this with you
          </AppText>
          <AppText>{sampleReading.action}</AppText>
        </Surface>

        <Surface>
          <AppText color="gold" variant="label">
            Affirmation
          </AppText>
          <AppText style={styles.affirmation} variant="headline">
            {sampleReading.affirmation}
          </AppText>
        </Surface>

        <AppText color="textMuted" style={styles.saved} variant="caption">
          Added to Collection · Static fixture
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
