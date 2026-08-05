import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { spacing } from '@/theme/tokens';

export default function ShopScreen() {
  const router = useRouter();

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
        eyebrow="Clear terms, no urgency"
        title="Shop"
      />

      <StatusBanner
        message="1 free · 0 subscriber · 0 pack credits"
        title="Your current allowance"
      />

      <View style={styles.offers}>
        <Surface>
          <AppText color="gold" variant="caption">
            Repeatable consumable
          </AppText>
          <AppText variant="headline">10 Fortune Pack</AppText>
          <AppText color="textMuted">
            Adds exactly 10 spendable draw credits after server verification. Unused credits remain
            until spent or adjusted after a verified refund.
          </AppText>
          <AppButton disabled label="StoreKit price loads here" onPress={() => undefined} />
        </Surface>

        <Surface>
          <AppText color="gold" variant="caption">
            Month-to-month subscription
          </AppText>
          <AppText variant="headline">Oracle+ Monthly</AppText>
          <AppText color="textMuted">
            Adds 10 fortunes per eligible account day while active or in a verified grace period.
            Auto-renews monthly until cancelled; no 12-month commitment.
          </AppText>
          <AppButton disabled label="StoreKit price loads here" onPress={() => undefined} />
        </Surface>

        <AppButton
          disabled
          label="Restore Purchases"
          onPress={() => undefined}
          variant="secondary"
        />
        <AppText color="textMuted" style={styles.disclosure} variant="caption">
          Restore Purchases rechecks your Apple subscription and synchronizes pack credits already
          recorded for this Fortuneness account. Commerce connects in Phase 9.
        </AppText>
        <AppText color="textMuted" style={styles.disclosure} variant="caption">
          Terms of Use · Privacy Policy · Manage Subscription
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  offers: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  disclosure: {
    textAlign: 'center',
  },
});
