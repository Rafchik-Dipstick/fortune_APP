import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useState } from 'react';

import { colors, layout, radii, spacing } from '@/theme/tokens';

import { AppText } from './app-text';

type ButtonVariant = 'primary' | 'secondary' | 'quiet';

interface AppButtonProps {
  accessibilityLabel?: string;
  compact?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
}

export function AppButton({
  accessibilityLabel,
  compact = false,
  disabled = false,
  label,
  onPress,
  variant = 'primary',
}: AppButtonProps) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => {
        setFocused(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compact : styles.standard,
        variantStyles[variant],
        pressed && !disabled ? styles.pressed : undefined,
        focused ? styles.focused : undefined,
        disabled ? styles.disabled : undefined,
      ]}
    >
      <AppText color={variant === 'primary' ? 'text' : 'gold'} variant="label">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    borderWidth: 1,
  },
  standard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  compact: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  focused: {
    borderColor: colors.focus,
    borderWidth: 2,
  },
  disabled: {
    opacity: 0.45,
  },
});

const variantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: colors.goldMuted,
    borderColor: colors.gold,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.goldMuted,
  },
  quiet: {
    backgroundColor: colors.transparent,
    borderColor: colors.transparent,
  },
});
