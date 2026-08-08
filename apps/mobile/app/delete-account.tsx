import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  buildDeletionRequest,
  emptyAcknowledgements,
  requiresAppleBillingAcknowledgement,
  submitAccountDeletion,
  type DeletionAcknowledgements,
} from '@/account/deletion-flow';
import { useAuthentication } from '@/auth/authentication';
import { requestAccountDeletion } from '@/auth/api-client';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Surface } from '@/components/surface';
import { useCommerce } from '@/iap/commerce';
import { colors, spacing } from '@/theme/tokens';

interface AcknowledgementRowProps {
  description: string;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}

function AcknowledgementRow({ description, label, onValueChange, value }: AcknowledgementRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
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

export default function DeleteAccountScreen() {
  const router = useRouter();
  const authentication = useAuthentication();
  const commerce = useCommerce();
  const [acknowledgements, setAcknowledgements] =
    useState<DeletionAcknowledgements>(emptyAcknowledgements);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<string>();

  const appleBillingRequired = requiresAppleBillingAcknowledgement(
    commerce.callerState,
    new Date(),
  );
  const body = buildDeletionRequest(acknowledgements, appleBillingRequired);

  const acknowledge = (key: keyof DeletionAcknowledgements) => (value: boolean) => {
    setFailure(undefined);
    setAcknowledgements((current) => ({ ...current, [key]: value }));
  };

  const confirm = () => {
    if (body === undefined || isSubmitting) {
      return;
    }
    setFailure(undefined);
    setIsSubmitting(true);
    void (async () => {
      const outcome = await submitAccountDeletion(
        {
          getAccessToken: () => authentication.session?.accessToken ?? '',
          reauthenticate: () => authentication.reauthenticate(),
          request: requestAccountDeletion,
        },
        body,
      );
      setIsSubmitting(false);
      if (outcome.kind === 'FAILED') {
        setFailure(outcome.message);
        return;
      }
      // Every session was revoked when the request committed, so the app
      // returns to the gate, which owns status and cancellation from here.
      await authentication.enterDeletionPending();
    })();
  };

  return (
    <Screen readingWidth>
      <PageHeader
        actions={
          <AppButton
            compact
            label="Back"
            onPress={() => {
              router.back();
            }}
            variant="quiet"
          />
        }
        eyebrow="Privacy and account"
        title="Delete account"
      />

      <View style={styles.sections}>
        <Surface>
          <AppText variant="headline">What deletion does</AppText>
          <AppText color="textMuted">
            Your Fortuneness account enters a 30-day processing period. Readings, your collection,
            and any remaining allowance stop being available immediately. When the period ends the
            account and its personal data are deleted permanently and cannot be restored.
          </AppText>
          <AppText color="textMuted">
            You can keep the account at any time during the processing period by signing in with
            Apple again.
          </AppText>
        </Surface>

        <Surface>
          <AcknowledgementRow
            description="Readings, your collection, and any remaining allowance stop being available as soon as the request is made."
            label="I understand access ends now"
            onValueChange={acknowledge('accessEnds')}
            value={acknowledgements.accessEnds}
          />
          <AcknowledgementRow
            description="After the 30-day processing period the account and its personal data are gone permanently. Purchases cannot be transferred or restored to a new account."
            label="I understand the data cannot be recovered"
            onValueChange={acknowledge('dataLoss')}
            value={acknowledgements.dataLoss}
          />
          {appleBillingRequired ? (
            <AcknowledgementRow
              description="Deleting a Fortuneness account does not cancel an App Store subscription. Cancel it in Settings › Apple Account › Subscriptions, or Apple will keep billing it."
              label="I understand Apple billing continues until I cancel"
              onValueChange={acknowledge('appleBilling')}
              value={acknowledgements.appleBilling}
            />
          ) : null}
        </Surface>

        {appleBillingRequired ? (
          <Surface>
            <AppText variant="label">Cancel the subscription first</AppText>
            <AppText color="textMuted" variant="caption">
              Only Apple can cancel an App Store subscription. Fortuneness cannot do it for you.
            </AppText>
            <AppButton
              disabled={!commerce.storeKitAvailable}
              label="Manage Subscription"
              onPress={() => {
                void commerce.manageSubscription();
              }}
              variant="secondary"
            />
          </Surface>
        ) : null}

        <Surface>
          <AppButton
            disabled={body === undefined || isSubmitting}
            label={isSubmitting ? 'Requesting deletion…' : 'Delete my account'}
            onPress={confirm}
          />
          <AppText color="textMuted" variant="caption">
            Deleting requires an Apple sign-in from the last five minutes; you may be asked to sign
            in again.
          </AppText>
          {failure === undefined ? null : (
            <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
              {failure}
            </AppText>
          )}
          <AppButton
            label="Keep my account"
            onPress={() => {
              router.back();
            }}
            variant="quiet"
          />
        </Surface>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
});
