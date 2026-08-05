import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme/tokens';

import { AppText } from './app-text';

interface PageHeaderProps {
  actions?: ReactNode;
  eyebrow?: string;
  title: string;
}

export function PageHeader({ actions, eyebrow, title }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        {eyebrow ? (
          <AppText color="gold" variant="caption">
            {eyebrow}
          </AppText>
        ) : null}
        <AppText accessibilityRole="header" variant="title">
          {title}
        </AppText>
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  copy: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
