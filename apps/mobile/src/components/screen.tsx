import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAdaptiveLayout } from '@/theme/adaptive';
import { colors, layout, spacing } from '@/theme/tokens';

import { CelestialBackdrop } from './celestial-backdrop';

interface ScreenProps {
  children: ReactNode;
  readingWidth?: boolean;
}

export function Screen({ children, readingWidth = false }: ScreenProps) {
  const { gutter } = useAdaptiveLayout();

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <CelestialBackdrop />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: gutter }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.content,
            { maxWidth: readingWidth ? layout.readingMax : layout.contentMax },
          ]}
        >
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
});
