import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMotionPreference } from '@/motion/motion-preference';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { useAdaptiveLayout } from '@/theme/adaptive';
import { colors, radii, spacing } from '@/theme/tokens';

import { AppButton } from './app-button';
import { AppText } from './app-text';

interface AdaptiveSheetProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
  visible: boolean;
}

export function AdaptiveSheet({ children, onClose, title, visible }: AdaptiveSheetProps) {
  const { isRegular } = useAdaptiveLayout();
  const systemReduceMotion = useReducedMotion();
  const { reduceMoreMotion } = useMotionPreference();
  const reduceMotion = shouldReduceMotion(systemReduceMotion, reduceMoreMotion);

  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close sheet"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={['top', 'right', 'bottom', 'left']}
          style={[styles.sheet, isRegular ? styles.regular : styles.compact]}
        >
          <View style={styles.header}>
            <AppText accessibilityRole="header" variant="headline">
              {title}
            </AppText>
            <AppButton compact label="Close" onPress={onClose} variant="quiet" />
          </View>
          <View style={styles.content}>{children}</View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7, 5, 14, 0.86)',
  },
  sheet: {
    borderColor: colors.goldMuted,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  compact: {
    width: '100%',
    height: '100%',
  },
  regular: {
    width: '88%',
    maxWidth: 560,
    maxHeight: '88%',
    borderRadius: radii.surface,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  content: {
    gap: spacing.md,
  },
});
