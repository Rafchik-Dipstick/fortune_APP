import { StyleSheet } from 'react-native';

import { spacing } from '@/theme/tokens';

import { AppButton } from './app-button';
import { AppText } from './app-text';
import { Surface } from './surface';

interface ErrorStateProps {
  actionLabel?: string;
  message: string;
  onRetry: () => void;
  title: string;
}

export function ErrorState({
  actionLabel = 'Try again',
  message,
  onRetry,
  title,
}: ErrorStateProps) {
  return (
    <Surface style={styles.state}>
      <AppText accessibilityLiveRegion="assertive" color="danger" variant="headline">
        {title}
      </AppText>
      <AppText color="textMuted">{message}</AppText>
      <AppButton label={actionLabel} onPress={onRetry} variant="secondary" />
    </Surface>
  );
}

const styles = StyleSheet.create({
  state: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    gap: spacing.md,
    marginTop: spacing.xl,
  },
});
