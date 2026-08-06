import 'react-native-gesture-handler';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { AuthenticationGate } from '@/auth/authentication-gate';
import { AuthenticationProvider } from '@/auth/authentication';
import { QaLocaleProvider } from '@/i18n/qa-locale';
import { LocalDataProvider } from '@/local-data/local-data';
import { MotionPreferenceProvider, useMotionPreference } from '@/motion/motion-preference';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QaLocaleProvider>
          <AuthenticationProvider>
            <LocalDataProvider>
              <AuthenticationGate>
                <MotionPreferenceProvider>
                  <AppNavigation />
                </MotionPreferenceProvider>
              </AuthenticationGate>
            </LocalDataProvider>
          </AuthenticationProvider>
        </QaLocaleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigation() {
  const systemReduceMotion = useReducedMotion();
  const { reduceMoreMotion } = useMotionPreference();
  const reduceMotion = shouldReduceMotion(systemReduceMotion, reduceMoreMotion);

  return (
    <>
      <Stack
        screenOptions={{
          animation: reduceMotion ? 'none' : 'fade_from_bottom',
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      />
      <StatusBar style="light" />
    </>
  );
}
