import { Pressable, StyleSheet, View } from 'react-native';
import { useState } from 'react';

import { fortuneIntentions, type FortuneIntention } from '@fortuneness/shared-types';

import { colors, layout, radii, spacing } from '@/theme/tokens';

import { AppText } from './app-text';

const labels: Record<FortuneIntention, string> = {
  GENERAL: 'General',
  LOVE: 'Love',
  WORK: 'Work',
  GROWTH: 'Growth',
};

interface IntentionSelectorProps {
  onChange: (intention: FortuneIntention) => void;
  value: FortuneIntention;
}

export function IntentionSelector({ onChange, value }: IntentionSelectorProps) {
  const [focusedIntention, setFocusedIntention] = useState<FortuneIntention | null>(null);

  return (
    <View accessibilityLabel="Reading intention" accessibilityRole="radiogroup" style={styles.row}>
      {fortuneIntentions.map((intention) => {
        const selected = intention === value;
        return (
          <Pressable
            accessibilityLabel={labels[intention]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={intention}
            onBlur={() => {
              setFocusedIntention(null);
            }}
            onFocus={() => {
              setFocusedIntention(intention);
            }}
            onPress={() => {
              onChange(intention);
            }}
            style={({ pressed }) => [
              styles.option,
              selected ? styles.selected : undefined,
              focusedIntention === intention ? styles.focused : undefined,
              pressed ? styles.pressed : undefined,
            ]}
          >
            <AppText color={selected ? 'text' : 'textMuted'} variant="label">
              {labels[intention]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  option: {
    minHeight: layout.minimumTouchTarget,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  selected: {
    borderColor: colors.gold,
    backgroundColor: colors.surfaceRaised,
  },
  focused: {
    borderColor: colors.focus,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.8,
  },
});
