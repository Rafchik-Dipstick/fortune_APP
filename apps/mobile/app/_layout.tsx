import 'react-native-gesture-handler';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { QaLocaleProvider } from '@/i18n/qa-locale';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <QaLocaleProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            animation: 'fade_from_bottom',
            contentStyle: { backgroundColor: colors.background },
            headerShown: false,
          }}
        />
        <StatusBar style="light" />
      </GestureHandlerRootView>
    </QaLocaleProvider>
  );
}
