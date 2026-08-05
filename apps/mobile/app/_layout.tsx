import 'react-native-gesture-handler';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReducedMotion } from 'react-native-reanimated';

import { QaLocaleProvider } from '@/i18n/qa-locale';
import { MotionPreferenceProvider, useMotionPreference } from '@/motion/motion-preference';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <QaLocaleProvider>
      <MotionPreferenceProvider>
        <AppNavigation />
      </MotionPreferenceProvider>
    </QaLocaleProvider>
  );
}

function AppNavigation() {
  const systemReduceMotion = useReducedMotion();
  const { reduceMoreMotion } = useMotionPreference();
  const reduceMotion = shouldReduceMotion(systemReduceMotion, reduceMoreMotion);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          animation: reduceMotion ? 'none' : 'fade_from_bottom',
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      />
      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}
