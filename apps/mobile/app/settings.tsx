import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuthentication } from '@/auth/authentication';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { useQaLocale } from '@/i18n/qa-locale';
import { useMotionPreference } from '@/motion/motion-preference';
import { colors, spacing } from '@/theme/tokens';

interface SettingRowProps {
  description: string;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}

function SettingRow({ description, label, onValueChange, value }: SettingRowProps) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <AppText variant="label">{label}</AppText>
        <AppText color="textMuted" variant="caption">
          {description}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={label}
        onValueChange={onValueChange}
        thumbColor={value ? colors.gold : colors.textMuted}
        trackColor={{ false: colors.surfaceRaised, true: colors.teal }}
        value={value}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const authentication = useAuthentication();
  const { locale, pseudoLocaleAvailable, setLocale } = useQaLocale();
  const { reduceMoreMotion, setReduceMoreMotion } = useMotionPreference();
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);

  return (
    <Screen readingWidth>
      <PageHeader
        actions={
          <AppButton
            compact
            label="Done"
            onPress={() => {
              router.back();
            }}
            variant="quiet"
          />
        }
        eyebrow="Account and experience"
        title="Settings"
      />

      <View style={styles.sections}>
        <Surface>
          <AppText color="gold" variant="caption">
            Game Center
          </AppText>
          <AppText variant="headline">
            {authentication.session?.alias ?? 'Game Center player'}
          </AppText>
          <AppText color="textMuted">Synced Fortuneness account</AppText>
          <AppButton
            label="Disconnect on this device"
            onPress={() => {
              void authentication.disconnect();
            }}
            variant="secondary"
          />
          <AppText color="textMuted" variant="caption">
            This clears Fortuneness tokens. Switch the Game Center player in Apple Settings.
          </AppText>
        </Surface>

        <Surface>
          <AppText color="gold" variant="caption">
            Account day
          </AppText>
          <AppText variant="headline">Europe/Kyiv</AppText>
          <AppText color="textMuted">
            Next reset at 12:00 AM. Device time-zone changes require confirmation and cannot create
            an extra allowance.
          </AppText>
        </Surface>

        <Surface>
          <SettingRow
            description="Optional soft paper and shimmer sounds."
            label="Sound"
            onValueChange={setSound}
            value={sound}
          />
          <SettingRow
            description="Selection, draw, and reveal feedback."
            label="Haptics"
            onValueChange={setHaptics}
            value={haptics}
          />
          <SettingRow
            description="Follow iOS Reduce Motion and reduce additional effects for this session."
            label="Reduce more motion"
            onValueChange={setReduceMoreMotion}
            value={reduceMoreMotion}
          />
        </Surface>

        <Surface>
          <AppText variant="label">Reminder</AppText>
          <AppText color="textMuted">
            Offered only after the first completed reading. Default: 9:00 AM account time.
          </AppText>
          <AppButton
            disabled
            label="Enable after first reading"
            onPress={() => undefined}
            variant="secondary"
          />
        </Surface>

        <Surface>
          <AppText variant="label">Privacy and account</AppText>
          <AppText color="textMuted">
            Privacy Policy · Terms of Use · Support · Restore Purchases · Delete account
          </AppText>
          <AppText color="textMuted" variant="caption">
            Fortuneness offers tarot-inspired reflections for entertainment and personal
            contemplation. It does not predict certain outcomes or provide medical, legal,
            financial, or mental-health advice.
          </AppText>
        </Surface>

        {pseudoLocaleAvailable ? (
          <Surface>
            <AppText color="gold" variant="caption">
              Phase 2 locale QA
            </AppText>
            <SettingRow
              description="Expands visible copy in this session to expose clipping and wrapping defects."
              label="Length-expanded pseudo-locale"
              onValueChange={(enabled) => {
                setLocale(enabled ? 'en-XA' : 'en');
              }}
              value={locale === 'en-XA'}
            />
            <AppText color="textMuted" variant="caption">
              {`Current fixture locale: ${locale}. This control is unavailable in production.`}
            </AppText>
          </Surface>
        ) : null}

        {__DEV__ ? (
          <Surface>
            <AppText color="gold" variant="caption">
              Phase 2 review tools
            </AppText>
            <AppText color="textMuted">
              Inspect every generated card in full upright and compact reversed frames, plus the
              brand mark at small icon sizes.
            </AppText>
            <AppButton
              label="Open art review"
              onPress={() => {
                router.push('/art-review');
              }}
              variant="secondary"
            />
          </Surface>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: spacing.lg,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  settingCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
});
