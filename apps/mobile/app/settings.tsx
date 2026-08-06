import { StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { IapCallerState } from '@fortuneness/api-contracts';

import { useAuthentication } from '@/auth/authentication';
import { useCommerce } from '@/iap/commerce';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { useQaLocale } from '@/i18n/qa-locale';
import { useMotionPreference } from '@/motion/motion-preference';
import { colors, spacing } from '@/theme/tokens';
import { useExperienceFeedback } from '@/feedback/experience-feedback';

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

/** Plain status wording; an inactive subscription is stated, never nudged. */
function subscriptionLabel(callerState: IapCallerState | undefined): string {
  switch (callerState?.subscription.status) {
    case undefined:
      return 'Oracle+ status loading';
    case 'ACTIVE':
      return 'Oracle+ is active';
    case 'GRACE_PERIOD':
      return 'Oracle+ is in a billing grace period';
    case 'BILLING_RETRY':
      return 'Oracle+ renewal is being retried by Apple';
    case 'EXPIRED':
      return 'Oracle+ has expired';
    case 'REVOKED':
      return 'Oracle+ was revoked';
    case 'NONE':
      return 'Oracle+ is not active';
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const authentication = useAuthentication();
  const commerce = useCommerce();
  const { locale, pseudoLocaleAvailable, setLocale } = useQaLocale();
  const { reduceMoreMotion, setReduceMoreMotion } = useMotionPreference();
  const feedback = useExperienceFeedback();

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
            onValueChange={feedback.setSoundEnabled}
            value={feedback.soundEnabled}
          />
          <SettingRow
            description="Selection, draw, and reveal feedback."
            label="Haptics"
            onValueChange={feedback.setHapticsEnabled}
            value={feedback.hapticsEnabled}
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
          <AppText color="gold" variant="caption">
            Purchases
          </AppText>
          <AppText variant="headline">{subscriptionLabel(commerce.callerState)}</AppText>
          <AppText color="textMuted">
            {commerce.callerState === undefined
              ? 'Your commerce state is loading.'
              : `${String(commerce.callerState.spendablePackCredits)} pack ${commerce.callerState.spendablePackCredits === 1 ? 'credit' : 'credits'} available on this account.`}
          </AppText>
          <AppButton
            disabled={commerce.isRestoring || !commerce.storeKitAvailable}
            label={commerce.isRestoring ? 'Rechecking with Apple…' : 'Restore Purchases'}
            onPress={() => {
              void commerce.restorePurchases();
            }}
            variant="secondary"
          />
          <AppText color="textMuted" variant="caption">
            Rechecks your Apple subscription and synchronizes pack credits already recorded for this
            Fortuneness account. It never creates a new charge.
          </AppText>
          <AppButton
            disabled={!commerce.storeKitAvailable}
            label="Manage Subscription"
            onPress={() => {
              void commerce.manageSubscription();
            }}
            variant="secondary"
          />
          {commerce.restoreSummary === undefined ? null : (
            <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
              {commerce.restoreSummary.message}
            </AppText>
          )}
          {commerce.manageError === undefined ? null : (
            <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
              {commerce.manageError}
            </AppText>
          )}
          <AppButton
            label="Open Shop"
            onPress={() => {
              router.push('/shop');
            }}
            variant="quiet"
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
