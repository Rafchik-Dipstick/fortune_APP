import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AdaptiveSheet } from '@/components/adaptive-sheet';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { ErrorState } from '@/components/error-state';
import { LoadingSkeleton } from '@/components/loading-skeleton';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { publicEnvironment } from '@/config/public-environment';
import { useFortuneRitual } from '@/fortune/fortune-ritual';
import { useCommerce } from '@/iap/commerce';
import { blockedReasonMessage, summarizeAllowance, type ShopOffer } from '@/iap/shop-catalog';
import { spacing } from '@/theme/tokens';

function OfferCard({
  busy,
  offer,
  onPurchase,
}: {
  busy: boolean;
  offer: ShopOffer;
  onPurchase: () => void;
}) {
  return (
    <Surface>
      <AppText color="gold" variant="caption">
        {offer.productType === 'CONSUMABLE'
          ? 'One-time purchase · repeatable'
          : 'Month-to-month subscription'}
      </AppText>
      <AppText accessibilityRole="header" variant="headline">
        {offer.title}
      </AppText>
      <AppText color="textMuted">{offer.benefit.description}</AppText>
      <AppButton
        accessibilityLabel={
          offer.displayPrice === null
            ? `${offer.title}, price unavailable`
            : `Buy ${offer.title} for ${offer.displayPrice}`
        }
        disabled={!offer.purchasable}
        label={
          busy
            ? 'Confirming with the App Store…'
            : (offer.displayPrice ?? 'Price unavailable right now')
        }
        onPress={onPurchase}
      />
      <AppText color="textMuted" variant="caption">
        {offer.disclosure}
      </AppText>
      {offer.blockedReason === null ? null : (
        <AppText color="textMuted" variant="caption">
          {blockedReasonMessage(offer.blockedReason)}
        </AppText>
      )}
    </Surface>
  );
}

export default function ShopScreen() {
  const router = useRouter();
  const commerce = useCommerce();
  const ritual = useFortuneRitual();
  const [termsVisible, setTermsVisible] = useState(false);
  const allowanceSummary = summarizeAllowance(ritual.allowance, commerce.callerState);
  const phase = commerce.purchasePhase;
  const busyProductId =
    phase.kind === 'PURCHASING' || phase.kind === 'PENDING' ? phase.productId : undefined;

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
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
        eyebrow="Clear terms, no urgency"
        title="Shop"
      />

      <StatusBanner message={allowanceSummary.detail} title={allowanceSummary.headline} />

      {phase.kind === 'CANCELLED' ? (
        <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
          Purchase cancelled. Nothing was charged and your allowance is unchanged.
        </AppText>
      ) : null}
      {phase.kind === 'PENDING' ? (
        <StatusBanner
          message="Apple is waiting for approval on this purchase. Nothing is granted until it is approved and verified; you can keep using Fortuneness meanwhile."
          title="Waiting for approval"
        />
      ) : null}
      {phase.kind === 'SUCCEEDED' ? (
        <StatusBanner message={phase.message} title="Purchase confirmed" />
      ) : null}
      {phase.kind === 'FAILED' ? (
        <AppText accessibilityLiveRegion="assertive" color="danger" variant="caption">
          {phase.message}
        </AppText>
      ) : null}
      {commerce.restoreSummary === undefined ? null : (
        <StatusBanner message={commerce.restoreSummary.message} title="Restore Purchases" />
      )}
      {commerce.manageError === undefined ? null : (
        <AppText accessibilityLiveRegion="polite" color="textMuted" variant="caption">
          {commerce.manageError}
        </AppText>
      )}

      {commerce.isCatalogLoading ? (
        <LoadingSkeleton />
      ) : commerce.catalogError !== undefined ? (
        <ErrorState
          message="The Fortuneness benefit catalog could not be loaded, so nothing is offered for sale right now. No purchase was started."
          onRetry={() => {
            void commerce.retryCatalog();
          }}
          title="Shop is temporarily unavailable"
        />
      ) : (
        <View style={styles.offers}>
          {commerce.offers.map((offer) => (
            <OfferCard
              busy={busyProductId === offer.productId}
              key={offer.productId}
              offer={offer}
              onPurchase={() => {
                void commerce.purchase(offer.productId);
              }}
            />
          ))}

          <Surface>
            <AppText variant="label">Already purchased?</AppText>
            <AppButton
              disabled={commerce.isRestoring || !commerce.storeKitAvailable}
              label={commerce.isRestoring ? 'Rechecking with Apple…' : 'Restore Purchases'}
              onPress={() => {
                void commerce.restorePurchases();
              }}
              variant="secondary"
            />
            <AppText color="textMuted" variant="caption">
              Rechecks your Apple subscription and synchronizes pack credits already recorded for
              this Fortuneness account. It never creates a new charge.
            </AppText>
            <AppButton
              disabled={!commerce.storeKitAvailable}
              label="Manage Subscription"
              onPress={() => {
                void commerce.manageSubscription();
              }}
              variant="secondary"
            />
            <AppText color="textMuted" variant="caption">
              Opens Apple&apos;s subscription settings, where Oracle+ can be cancelled at any time.
            </AppText>
          </Surface>

          <View style={styles.disclosures}>
            <AppButton
              label="Terms of Use"
              onPress={() => {
                openLink(publicEnvironment.termsUrl);
              }}
              variant="quiet"
            />
            <AppButton
              label="Privacy Policy"
              onPress={() => {
                openLink(publicEnvironment.privacyUrl);
              }}
              variant="quiet"
            />
            <AppButton
              label="How purchases work"
              onPress={() => {
                setTermsVisible(true);
              }}
              variant="quiet"
            />
          </View>
          <AppText color="textMuted" style={styles.centered} variant="caption">
            Fortuneness offers tarot-inspired reflections for entertainment. Purchases add readings;
            they never change what a reading says.
          </AppText>
        </View>
      )}

      <AdaptiveSheet
        onClose={() => {
          setTermsVisible(false);
        }}
        title="How purchases work"
        visible={termsVisible}
      >
        <AppText color="textMuted">
          Apple presents the localized price and confirms payment. Fortuneness grants benefits only
          after the server verifies the signed transaction for this account.
        </AppText>
        <AppText color="textMuted">
          The free daily reading is always included and never expires. Oracle+ readings are used
          before pack credits, so a subscription day never spends a credit you paid for separately.
        </AppText>
        <AppText color="textMuted">
          Pack credits stay until you spend them. A verified refund removes the unspent units of
          that purchase, and cancelling Oracle+ keeps every card and reading you already collected.
        </AppText>
        <AppText color="textMuted">
          Restore Purchases checks existing Apple transactions. It does not create a new charge.
        </AppText>
        {commerce.catalog?.gracePeriodPolicy.enabled === true ? (
          <AppText color="textMuted">{commerce.catalog.gracePeriodPolicy.description}</AppText>
        ) : null}
      </AdaptiveSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  offers: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  disclosures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  centered: {
    textAlign: 'center',
  },
});
