import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme/tokens';

const rowWidths = ['100%', '82%', '64%'] as const;

export function LoadingSkeleton() {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0.62);

  useEffect(() => {
    opacity.value = reduceMotion ? 0.62 : withRepeat(withTiming(0.92, { duration: 900 }), -1, true);

    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View
      accessibilityLabel="Loading Oracle state."
      accessibilityRole="progressbar"
      style={styles.container}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, animatedStyle]}
      />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.rows}
      >
        {rowWidths.map((width) => (
          <Animated.View key={width} style={[styles.row, { width }, animatedStyle]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xl,
  },
  card: {
    width: '70%',
    maxWidth: 300,
    aspectRatio: 2 / 3,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceRaised,
  },
  rows: {
    width: '100%',
    maxWidth: 520,
    gap: spacing.sm,
  },
  row: {
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
});
