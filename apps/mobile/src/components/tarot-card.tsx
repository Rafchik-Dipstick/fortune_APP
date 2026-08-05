import type { ImageSourcePropType } from 'react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useState } from 'react';

import type { Orientation } from '@fortuneness/shared-types';

import { colors, layout, radii, spacing } from '@/theme/tokens';

import { AppText } from './app-text';

interface FaceUpCardProps {
  artAltText: string;
  cardName: string;
  illustration?: ImageSourcePropType;
  number: string;
  orientation: Orientation;
  suitSymbol?: string;
}

interface TarotCardProps {
  accessibilityLabel?: string;
  compact?: boolean;
  face: 'down' | 'up';
  faceUp?: FaceUpCardProps;
  onPress?: () => void;
  width: number;
}

export function TarotCard({
  accessibilityLabel: accessibilityLabelOverride,
  compact = false,
  face,
  faceUp,
  onPress,
  width,
}: TarotCardProps) {
  const [focused, setFocused] = useState(false);
  const isFaceDown = face === 'down';
  const accessibilityLabel =
    accessibilityLabelOverride ??
    (isFaceDown
      ? 'Draw a tarot card.'
      : `${faceUp?.cardName ?? 'Tarot card'}, ${faceUp?.orientation.toLowerCase() ?? 'upright'}. ${faceUp?.artAltText ?? ''}`);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : 'image'}
      disabled={!onPress}
      onBlur={() => {
        setFocused(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { width },
        compact ? styles.compact : undefined,
        focused ? styles.focused : undefined,
        pressed && onPress ? styles.pressed : undefined,
      ]}
    >
      {isFaceDown ? <CardBack /> : faceUp ? <CardFace {...faceUp} /> : null}
    </Pressable>
  );
}

function CardBack() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.back}
    >
      <View style={styles.backRow}>
        <AppText color="gold">✦</AppText>
        <AppText color="gold">☾</AppText>
        <AppText color="gold">✦</AppText>
      </View>
      <View style={styles.backCenter}>
        <AppText color="gold" style={styles.moon}>
          ☽
        </AppText>
        <AppText color="gold" style={styles.starLine}>
          · ✦ · ✧ · ✦ ·
        </AppText>
      </View>
      <View style={[styles.backRow, styles.rotated]}>
        <AppText color="gold">✦</AppText>
        <AppText color="gold">☾</AppText>
        <AppText color="gold">✦</AppText>
      </View>
    </View>
  );
}

function CardFace({
  artAltText,
  cardName,
  illustration,
  number,
  orientation,
  suitSymbol = '✦',
}: FaceUpCardProps) {
  const reversed = orientation === 'REVERSED';

  return (
    <View style={styles.face}>
      <View style={styles.cardLabelRow}>
        <AppText color="gold" variant="caption">
          {number}
        </AppText>
        <AppText color="gold" variant="caption">
          {suitSymbol}
        </AppText>
      </View>
      <View style={styles.illustrationFrame}>
        {illustration ? (
          <Image
            accessibilityLabel={artAltText}
            resizeMode="cover"
            source={illustration}
            style={[styles.illustration, reversed ? styles.reversed : undefined]}
          />
        ) : (
          <View
            accessibilityLabel={artAltText}
            accessibilityRole="image"
            style={styles.illustrationPlaceholder}
          >
            <AppText color="gold" style={styles.placeholderMoon}>
              ☾
            </AppText>
            <AppText color="textMuted" style={styles.placeholderCopy} variant="caption">
              Illustration proof pending
            </AppText>
          </View>
        )}
      </View>
      <View style={styles.cardNameBlock}>
        <AppText style={styles.cardName} variant="label">
          {cardName}
        </AppText>
        <AppText color="textMuted" style={styles.orientation} variant="caption">
          {reversed ? 'Reversed' : 'Upright'}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: layout.cardMax,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    borderColor: colors.gold,
    borderRadius: radii.card,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
    shadowColor: colors.focus,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
  },
  compact: {
    borderRadius: radii.control,
  },
  focused: {
    borderColor: colors.focus,
    borderWidth: 3,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ translateY: 2 }],
  },
  back: {
    flex: 1,
    justifyContent: 'space-between',
    borderColor: colors.goldMuted,
    borderRadius: radii.card - 5,
    borderWidth: 1,
    margin: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  backRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backCenter: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  moon: {
    fontSize: 56,
  },
  starLine: {
    fontSize: 18,
    letterSpacing: 3,
  },
  rotated: {
    transform: [{ rotate: '180deg' }],
  },
  face: {
    flex: 1,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  cardLabelRow: {
    minHeight: layout.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  illustrationFrame: {
    flex: 1,
    overflow: 'hidden',
    borderColor: colors.goldMuted,
    borderRadius: radii.control,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceRaised,
  },
  illustration: {
    width: '100%',
    height: '100%',
  },
  reversed: {
    transform: [{ rotate: '180deg' }],
  },
  illustrationPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  placeholderMoon: {
    fontSize: 52,
  },
  placeholderCopy: {
    textAlign: 'center',
  },
  cardNameBlock: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  cardName: {
    fontFamily: 'Georgia',
    textAlign: 'center',
  },
  orientation: {
    textAlign: 'center',
  },
});
