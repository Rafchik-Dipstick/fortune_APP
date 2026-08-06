import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/tokens';

import { CelestialBackdrop } from './celestial-backdrop';

/**
 * Screen shell for virtualized pages: same backdrop and safe areas as Screen,
 * but the child list owns scrolling, so large collections stay windowed
 * instead of mounting inside a ScrollView.
 */
export function ListScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <CelestialBackdrop />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
