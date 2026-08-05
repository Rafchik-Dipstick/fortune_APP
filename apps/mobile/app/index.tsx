import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAppCopy } from '@/i18n/copy';
import { scaffoldTheme } from '@/theme/scaffold-theme';

export default function LaunchScaffoldScreen() {
  const copy = getAppCopy(process.env.EXPO_PUBLIC_LOCALE_OVERRIDE);

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View accessible accessibilityRole="summary" style={styles.panel}>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.symbol}>☾ ✦ ☽</Text>
          </View>
          <Text accessibilityRole="header" style={styles.headline}>
            {copy.headline}
          </Text>
          <Text style={styles.body}>{copy.body}</Text>
          <Text style={styles.status}>{copy.status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: scaffoldTheme.background,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  panel: {
    width: '100%',
    maxWidth: 680,
    alignItems: 'center',
    borderColor: scaffoldTheme.gold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    backgroundColor: scaffoldTheme.surface,
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  eyebrow: {
    color: scaffoldTheme.gold,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 12,
    color: scaffoldTheme.text,
    fontSize: 40,
    fontWeight: '600',
    textAlign: 'center',
  },
  symbol: {
    marginVertical: 20,
    color: scaffoldTheme.gold,
    fontSize: 22,
    letterSpacing: 8,
  },
  headline: {
    color: scaffoldTheme.text,
    fontSize: 24,
    fontWeight: '500',
    lineHeight: 32,
    textAlign: 'center',
  },
  body: {
    marginTop: 16,
    color: scaffoldTheme.textMuted,
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
  },
  status: {
    marginTop: 28,
    color: scaffoldTheme.gold,
    fontSize: 13,
    fontWeight: '600',
  },
});
