import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { verticalSliceCards } from '@/fixtures/vertical-slice';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { colors, layout, radii, spacing } from '@/theme/tokens';

type CollectionMode = 'deck' | 'readings';

export default function CollectionScreen() {
  const router = useRouter();
  const { width } = useAdaptiveLayout();
  const [mode, setMode] = useState<CollectionMode>('deck');
  const cardWidth = width < 600 ? Math.min((width - 56) / 2, 160) : 180;

  return (
    <Screen>
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
        <>
          <Surface style={styles.progress}>
            <AppText variant="headline">3 / 78 discovered</AppText>
            <AppText color="textMuted">
              Upright and reversed discoveries remain visible for the life of the account.
            </AppText>
          </Surface>
          <View style={styles.grid}>
            {verticalSliceCards.map((card) => (
              <View key={card.key} style={{ width: cardWidth }}>
                <TarotCard
                  compact
                  face="up"
                  faceUp={{
                    artAltText: card.altText,
                    cardName: card.name,
                    ...(card.illustration ? { illustration: card.illustration } : {}),
                    number: card.number,
                    orientation: card.orientation,
                    suitSymbol: card.suitSymbol,
                  }}
                  width={cardWidth}
                />
              </View>
            ))}
            {Array.from({ length: 5 }, (_, index) => (
              <View
                accessible
                accessibilityLabel="Not yet discovered."
                key={`locked-${String(index)}`}
                style={{ width: cardWidth }}
              >
                <TarotCard
                  accessibilityLabel="Not yet discovered."
                  compact
                  face="down"
                  width={cardWidth}
                />
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.readingList}>
          <Surface>
            <AppText color="gold" variant="caption">
              Today · Growth · Upright
            </AppText>
            <AppText variant="headline">Begin before certainty arrives</AppText>
            <AppText color="textMuted">
              The Fool · Free daily reading · Saved on this device
            </AppText>
          </Surface>
          <Surface>
            <AppText color="gold" variant="caption">
              Offline archive fixture
            </AppText>
            <AppText variant="headline">1 saved reading</AppText>
            <AppText color="textMuted">
              Filters apply only to saved readings while offline. Last sync: just now.
            </AppText>
          </Surface>
        </View>
      )}
    </Screen>
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
  progress: {
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
  },
  readingList: {
    gap: spacing.md,
  },
});
