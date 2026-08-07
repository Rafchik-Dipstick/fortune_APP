import type { ImageSourcePropType } from 'react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useState } from 'react';

import type { Orientation } from '@fortuneness/shared-types';

import { colors, layout, radii, spacing } from '@/theme/tokens';

import { AppText } from './app-text';

export interface FaceUpCardProps {
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
      <View style={styles.backInner}>
        <View style={styles.backRow}>
          <AppText color="gold" style={styles.backGlyph}>
            ✦
          </AppText>
          <AppText color="gold" style={styles.backGlyph}>
            ☾
          </AppText>
          <AppText color="gold" style={styles.backGlyph}>
            ✦
          </AppText>
        </View>
        <View style={styles.backCenter}>
          <View style={styles.moonRing}>
            <View style={styles.moonRingInner}>
              <AppText color="gold" style={styles.moon}>
                ☽
              </AppText>
            </View>
          </View>
          <AppText color="gold" style={styles.starLine}>
            · ✦ · ✧ · ✦ ·
          </AppText>
        </View>
        <View style={[styles.backRow, styles.rotated]}>
          <AppText color="gold" style={styles.backGlyph}>
            ✦
          </AppText>
          <AppText color="gold" style={styles.backGlyph}>
            ☾
          </AppText>
          <AppText color="gold" style={styles.backGlyph}>
            ✦
          </AppText>
        </View>
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
        <AppText color="gold" style={styles.labelGlyph} variant="caption">
          {number}
        </AppText>
        <AppText color="gold" style={styles.labelGlyph} variant="caption">
          {suitSymbol}
        </AppText>
      </View>
      <View style={styles.illustrationOuterFrame}>
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
      </View>
      <View style={styles.cardNameBlock}>
        <AppText color="gold" style={styles.nameDivider}>
          · ✦ ·
        </AppText>
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
    shadowOpacity: 0.2,
    shadowRadius: 26,
  },
  compact: {
    borderRadius: radii.control,
  },
  focused: {
    borderColor: colors.focus,
    borderWidth: 3,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ translateY: 2 }, { scale: 0.98 }],
  },
  back: {
    flex: 1,
    borderColor: colors.goldMuted,
    borderRadius: radii.card - 5,
    borderWidth: 1,
    margin: spacing.xs,
    padding: spacing.xxs,
    backgroundColor: colors.surface,
  },
  backInner: {
    flex: 1,
    justifyContent: 'space-between',
    borderColor: colors.goldMuted,
    borderRadius: radii.card - 9,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  backRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backGlyph: {
    textShadowColor: colors.gold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  backCenter: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  moonRing: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 128,
    height: 128,
    borderColor: colors.goldMuted,
    borderRadius: 64,
    borderWidth: 1,
  },
  moonRingInner: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 108,
    height: 108,
    borderColor: colors.goldMuted,
    borderRadius: 54,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceRaised,
  },
  moon: {
    fontSize: 56,
    textShadowColor: colors.gold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  starLine: {
    fontSize: 18,
    letterSpacing: 3,
    textShadowColor: colors.gold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
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
  labelGlyph: {
    letterSpacing: 1,
    textShadowColor: colors.gold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  illustrationOuterFrame: {
    flex: 1,
    borderColor: colors.goldMuted,
    borderRadius: radii.control + 3,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
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
    textShadowColor: colors.gold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  placeholderCopy: {
    textAlign: 'center',
  },
  cardNameBlock: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: spacing.xxs,
  },
  nameDivider: {
    fontSize: 11,
    letterSpacing: 2,
  },
  cardName: {
    fontFamily: 'Georgia',
    fontSize: 17,
    letterSpacing: 0.8,
    lineHeight: 22,
    textAlign: 'center',
  },
  orientation: {
    letterSpacing: 1.5,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
