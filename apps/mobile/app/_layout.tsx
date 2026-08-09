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
import { FortuneRitualProvider } from '@/fortune/fortune-ritual';
import { ExperienceFeedbackProvider } from '@/feedback/experience-feedback';
import { CommerceProvider } from '@/iap/commerce';
import { MotionPreferenceProvider, useMotionPreference } from '@/motion/motion-preference';
import { PerformanceProvider } from '@/observability/performance-provider';
import { RemindersProvider } from '@/reminders/reminders';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { colors } from '@/theme/tokens';

const releaseCaptureMode = process.env.EXPO_PUBLIC_RELEASE_CAPTURE_MODE === 'true';

export default function RootLayout() {
  if (releaseCaptureMode) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QaLocaleProvider>
            <AppNavigation />
          </QaLocaleProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PerformanceProvider>
          <QaLocaleProvider>
            <AuthenticationProvider>
              <LocalDataProvider>
                <AuthenticationGate>
                  <ExperienceFeedbackProvider>
                    <FortuneRitualProvider>
                      <CommerceProvider>
                        <RemindersProvider>
                          <MotionPreferenceProvider>
                            <AppNavigation />
                          </MotionPreferenceProvider>
                        </RemindersProvider>
                      </CommerceProvider>
                    </FortuneRitualProvider>
                  </ExperienceFeedbackProvider>
                </AuthenticationGate>
              </LocalDataProvider>
            </AuthenticationProvider>
          </QaLocaleProvider>
        </PerformanceProvider>
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
