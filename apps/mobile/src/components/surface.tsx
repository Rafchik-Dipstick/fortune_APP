import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

interface SurfaceProps {
  children: ReactNode;
  style?: ViewStyle;
}

export function Surface({ children, style }: SurfaceProps) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    borderColor: colors.goldMuted,
    borderRadius: radii.surface,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
    gap: spacing.md,
    padding: spacing.lg,
  },
});
