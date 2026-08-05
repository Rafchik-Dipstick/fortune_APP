import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

import { AppText } from './app-text';

interface StatusBannerProps {
  message: string;
  title: string;
}

export function StatusBanner({ message, title }: StatusBannerProps) {
  return (
    <View accessibilityRole="summary" style={styles.banner}>
      <AppText color="gold" variant="label">
        {title}
      </AppText>
      <AppText color="textMuted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderColor: colors.teal,
    borderRadius: radii.control,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
    gap: spacing.xxs,
    padding: spacing.md,
  },
});
