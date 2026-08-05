import { Image, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';

import type { Orientation } from '@fortuneness/shared-types';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard, type FaceUpCardProps } from '@/components/tarot-card';
import { verticalSliceCards, type VerticalSliceCard } from '@/fixtures/vertical-slice';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { colors, radii, spacing } from '@/theme/tokens';

import brandMark from '../../../tools/brand-assets/source/fortuneness-mark.png';

const iconSizes = [32, 60, 120] as const;

function toFaceUp(card: VerticalSliceCard, orientation: Orientation): FaceUpCardProps {
  return {
    artAltText: card.altText,
    cardName: card.name,
    ...(card.illustration ? { illustration: card.illustration } : {}),
    number: card.number,
    orientation,
    suitSymbol: card.suitSymbol,
  };
}

export default function ArtReviewScreen() {
  const router = useRouter();
  const { artReviewCardWidths } = useAdaptiveLayout();

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <Screen>
      <PageHeader
        actions={
          <AppButton
            compact
            label="Close review"
            onPress={() => {
              router.back();
            }}
            variant="quiet"
          />
        }
        eyebrow="Development only · no approval recorded"
        title="Phase 2 art review"
      />

      <StatusBanner
        message="Inspect on a signed iPhone and iPad build, then record evidence in the Phase 2 matrix."
        title="Three generated proofs · style remains unlocked"
      />

      <Surface style={styles.brandSurface}>
        <AppText color="gold" variant="caption">
          Brand-mark candidate
        </AppText>
        <AppText variant="headline">Small-size and mask preview</AppText>
        <View style={styles.iconRow}>
          {iconSizes.map((size) => (
            <View key={size} style={styles.iconPreview}>
              <Image
                accessibilityLabel={`Fortuneness brand-mark candidate at ${String(size)} points.`}
                source={brandMark}
                style={{
                  width: size,
                  height: size,
                  borderRadius: size * 0.22,
                }}
              />
              <AppText color="textMuted" variant="caption">
                {String(size)} pt
              </AppText>
            </View>
          ))}
        </View>
        <AppText color="textMuted" variant="caption">
          This rounded preview is a review aid, not a substitute for Apple’s actual icon masks.
        </AppText>
      </Surface>

      <View style={styles.cardSections}>
        {verticalSliceCards.map((card) => (
          <Surface key={card.key}>
            <View style={styles.cardHeading}>
              <View style={styles.cardHeadingCopy}>
                <AppText color="gold" variant="caption">
                  {card.arcana} · {card.key}
                </AppText>
                <AppText variant="headline">{card.name}</AppText>
              </View>
              <AppText color="textMuted" variant="caption">
                Generated · unreviewed
              </AppText>
            </View>

            <View style={styles.frameRow}>
              <View style={styles.framePreview}>
                <AppText color="textMuted" variant="caption">
                  Full · upright · {Math.round(artReviewCardWidths.full)} pt
                </AppText>
                <TarotCard
                  face="up"
                  faceUp={toFaceUp(card, 'UPRIGHT')}
                  width={artReviewCardWidths.full}
                />
              </View>
              <View style={styles.framePreview}>
                <AppText color="textMuted" variant="caption">
                  Compact · reversed · {Math.round(artReviewCardWidths.compact)} pt
                </AppText>
                <TarotCard
                  compact
                  face="up"
                  faceUp={toFaceUp(card, 'REVERSED')}
                  width={artReviewCardWidths.compact}
                />
              </View>
            </View>

            <View style={styles.altText}>
              <AppText color="gold" variant="label">
                Alternative text under review
              </AppText>
              <AppText color="textMuted">{card.altText}</AppText>
            </View>
          </Surface>
        ))}
      </View>

      <Surface>
        <AppText color="gold" variant="caption">
          Reviewer prompts
        </AppText>
        <AppText>• Is the subject readable at both sizes without relying on the card name?</AppText>
        <AppText>
          • Does reversal remain clear without changing or exposing the card’s identity?
        </AppText>
        <AppText>
          • Does generated decoration compete with the code-rendered frame or labels?
        </AppText>
        <AppText>• Does the spoken alternative text match the visible cropped artwork?</AppText>
        <AppText>• Are contrast, representation, density, and safe margins acceptable?</AppText>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandSurface: {
    marginBottom: spacing.lg,
  },
  iconRow: {
    minHeight: 148,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: spacing.xl,
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.background,
  },
  iconPreview: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardSections: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardHeadingCopy: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  frameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  framePreview: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  altText: {
    gap: spacing.xxs,
    paddingTop: spacing.sm,
  },
});
