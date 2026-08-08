import { useState } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import type { IapCallerState } from '@fortuneness/api-contracts';

import { useAuthentication } from '@/auth/authentication';
import { useConsumptionConsent } from '@/account/consumption-consent';
import { useCommerce } from '@/iap/commerce';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { publicEnvironment } from '@/config/public-environment';
import { useCollectionSummary } from '@/fortune/archive-data';
import { useQaLocale } from '@/i18n/qa-locale';
import { useMotionPreference } from '@/motion/motion-preference';
import { useReminders } from '@/reminders/reminders';
import { formatReminderTime } from '@/reminders/reminder-schedule';
import { colors, spacing } from '@/theme/tokens';
import { useExperienceFeedback } from '@/feedback/experience-feedback';

interface SettingRowProps {
  description: string;
  disabled?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}

function SettingRow({ description, disabled, label, onValueChange, value }: SettingRowProps) {
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
        disabled={disabled ?? false}
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

function formatInstant(value: string | null, timeZone: string): string {
  if (value === null) {
    return 'not scheduled';
  }
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'long',
    timeZone,
  }).format(new Date(value));
}

function openExternalUrl(url: string): void {
  void Linking.openURL(url);
}

export default function SettingsScreen() {
  const router = useRouter();
  const authentication = useAuthentication();
  const commerce = useCommerce();
  const reminders = useReminders();
  const consent = useConsumptionConsent();
  const collection = useCollectionSummary();
  const { locale, pseudoLocaleAvailable, setLocale } = useQaLocale();
  const { reduceMoreMotion, setReduceMoreMotion } = useMotionPreference();
  const feedback = useExperienceFeedback();
  const [reminderNotice, setReminderNotice] = useState<string>();

  const user = authentication.session?.user;
  // The reminder is offered only once a reading exists, which is exactly what
  // an unlocked card in the collection records.
  const hasFirstReading = (collection.data?.response.unlockedCount ?? 0) > 0;
  const buildNumber = Application.nativeBuildVersion ?? 'local';
  const version = Constants.expoConfig?.version ?? '0.0.0';

  const changeReminder = (enabled: boolean) => {
    setReminderNotice(undefined);
    void (async () => {
      if (!enabled) {
        await reminders.disableReminder();
        return;
      }
      const result = await reminders.enableReminder();
      if (result.kind === 'PERMISSION_DENIED') {
        setReminderNotice(
          'Notifications are turned off for Fortuneness. Turn them on in iOS Settings › Notifications › Fortuneness, then enable the reminder here.',
        );
      } else if (result.kind === 'UNAVAILABLE') {
        setReminderNotice('Local notifications are not available in this build.');
      } else if (result.kind === 'FAILED') {
        setReminderNotice(result.message);
      }
    })();
  };

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
            Apple Account
          </AppText>
          <AppText variant="headline">
            {authentication.session?.accountLabel ?? 'Apple Account'}
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
            This clears Fortuneness tokens from this device. Your Apple Account remains signed in.
          </AppText>
        </Surface>

        <Surface>
          <AppText color="gold" variant="caption">
            Account day
          </AppText>
          <AppText variant="headline">{user?.accountTimeZone ?? 'Loading'}</AppText>
          <AppText color="textMuted">
            {user?.pendingTimeZone === null || user === undefined
              ? 'Your daily allowance resets at midnight in this zone. Changing zones never creates an extra reading.'
              : `Moving to ${user.pendingTimeZone} at ${formatInstant(user.timeZoneEffectiveAt, user.accountTimeZone)}. The change takes effect at the next reset so no extra reading is created.`}
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
          <AppText color="gold" variant="caption">
            Reminder
          </AppText>
          {hasFirstReading ? (
            <>
              <SettingRow
                description={`One quiet reminder at ${formatReminderTime(reminders.preferences.reminderLocalMinutes)} in your account time zone. No notifications are sent until you turn this on.`}
                disabled={reminders.isBusy}
                label="Daily reminder"
                onValueChange={changeReminder}
                value={reminders.preferences.reminderEnabled}
              />
              {reminders.preferences.reminderEnabled && reminders.nextReminderAt !== undefined ? (
                <AppText color="textMuted" variant="caption">
                  {`Next reminder ${formatInstant(reminders.nextReminderAt.toISOString(), user?.accountTimeZone ?? 'UTC')}. Fortuneness keeps the next ${String(reminders.scheduledCount)} days scheduled and refreshes them when you open the app.`}
                </AppText>
              ) : null}
              {reminderNotice === undefined ? null : (
                <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
                  {reminderNotice}
                </AppText>
              )}
            </>
          ) : (
            <AppText color="textMuted">
              Available after your first reading. Fortuneness never asks for notification permission
              before you turn this on.
            </AppText>
          )}
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

        {consent.consent?.available === true ? (
          <Surface>
            <AppText color="gold" variant="caption">
              Refund information
            </AppText>
            <SettingRow
              description="Let Fortuneness answer Apple's refund questions with how much of a purchase you had used. It is never required, never affects your access, and turning it off stops future sharing."
              disabled={consent.isSaving}
              label="Share consumption information with Apple"
              onValueChange={consent.setGranted}
              value={consent.consent.granted}
            />
            <AppText color="textMuted" variant="caption">
              {consent.saveFailed
                ? 'That choice could not be saved. Nothing changed; try again in a moment.'
                : 'Turning this off stops future sharing. It cannot retract information already sent to Apple.'}
            </AppText>
          </Surface>
        ) : null}

        <Surface>
          <AppText color="gold" variant="caption">
            Privacy and account
          </AppText>
          <View style={styles.links}>
            <AppButton
              compact
              label="Privacy Policy"
              onPress={() => {
                openExternalUrl(publicEnvironment.privacyUrl);
              }}
              variant="quiet"
            />
            <AppButton
              compact
              label="Terms of Use"
              onPress={() => {
                openExternalUrl(publicEnvironment.termsUrl);
              }}
              variant="quiet"
            />
            <AppButton
              compact
              label="Support"
              onPress={() => {
                openExternalUrl(publicEnvironment.supportUrl);
              }}
              variant="quiet"
            />
          </View>
          <AppButton
            label="Delete account"
            onPress={() => {
              router.push('/delete-account');
            }}
            variant="secondary"
          />
          <AppText color="textMuted" variant="caption">
            {`Fortuneness ${version} (${buildNumber})`}
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
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
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
