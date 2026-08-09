import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { IntentionSelector } from '@/components/intention-selector';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { StatusBanner } from '@/components/status-banner';
import { Surface } from '@/components/surface';
import { TarotCard } from '@/components/tarot-card';
import { verticalSliceCards } from '@/fixtures/vertical-slice';
import { colors, spacing } from '@/theme/tokens';

const releaseCaptureMode = process.env.EXPO_PUBLIC_RELEASE_CAPTURE_MODE === 'true';
const noOp = () => undefined;
const previewNames = ['oracle', 'reveal', 'collection', 'shop'] as const;
type PreviewName = (typeof previewNames)[number];

function isPreviewName(value: string | undefined): value is PreviewName {
  return previewNames.some((name) => name === value);
}

function PreviewHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <PageHeader eyebrow={eyebrow} title={title} />;
}

function OraclePreview({ wide }: { wide: boolean }) {
  return (
    <Screen>
      <PreviewHeader eyebrow="A quiet daily ritual" title="Meet your Oracle" />
      <StatusBanner
        message="Your free daily reflection is ready whenever you are."
        title="1 reflection is ready"
      />
      <View style={[styles.hero, wide ? styles.heroWide : undefined]}>
        <View style={styles.cardColumn}>
          <TarotCard face="down" width={wide ? 300 : 210} />
          <AppButton label="Draw your card" onPress={noOp} />
        </View>
        <Surface style={styles.featurePanel}>
          <AppText color="gold" variant="caption">
            Set an intention
          </AppText>
          <AppText variant="headline">What would you like to notice today?</AppText>
          <AppText color="textMuted">
            Choose a focus, then receive a thoughtful tarot-inspired reflection.
          </AppText>
          <IntentionSelector onChange={noOp} value="GROWTH" />
          <AppText color="textMuted" variant="caption">
            Reflection, not certainty. Your free daily reading is always included.
          </AppText>
        </Surface>
      </View>
    </Screen>
  );
}

function RevealPreview({ wide }: { wide: boolean }) {
  const card = verticalSliceCards[0];
  return (
    <Screen readingWidth={!wide}>
      <PreviewHeader eyebrow="Your card has arrived" title="Begin before certainty arrives" />
      <View style={[styles.hero, wide ? styles.heroWide : undefined]}>
        <TarotCard
          face="up"
          faceUp={{
            artAltText: card.altText,
            cardName: card.name,
            ...(card.illustration === undefined ? {} : { illustration: card.illustration }),
            number: card.number,
            orientation: card.orientation,
            suitSymbol: card.suitSymbol,
          }}
          width={wide ? 310 : 205}
        />
        <View style={styles.revealCopy}>
          <Surface>
            <AppText color="gold" variant="caption">
              The Fool · Upright
            </AppText>
            <AppText variant="headline">Make room for discovery</AppText>
            <AppText color="textMuted">
              A beginning may be asking for your attention before every detail is settled. Notice
              where uncertainty has become a reason to stay still.
            </AppText>
          </Surface>
          <Surface>
            <AppText color="gold" variant="caption">
              A small next step
            </AppText>
            <AppText>Choose one beginning and give it ten honest minutes.</AppText>
            <AppText color="textMuted" variant="caption">
              “I can meet the unknown with curiosity.”
            </AppText>
          </Surface>
        </View>
      </View>
    </Screen>
  );
}

function CollectionPreview({ wide }: { wide: boolean }) {
  const repeatedCards = [
    ...verticalSliceCards,
    { ...verticalSliceCards[1], key: 'cups-queen-reversed', orientation: 'REVERSED' as const },
    { ...verticalSliceCards[2], key: 'wands-03-reversed', orientation: 'REVERSED' as const },
    { ...verticalSliceCards[0], key: 'major-00-fool-reversed', orientation: 'REVERSED' as const },
  ];
  const cardWidth = wide ? 140 : 96;
  return (
    <Screen>
      <PreviewHeader eyebrow="Saved for your account" title="Your collection grows with you" />
      <Surface style={styles.collectionSummary}>
        <AppText variant="headline">6 / 78 discoveries</AppText>
        <AppText color="textMuted">
          Every revealed card and reading stays in your private archive.
        </AppText>
      </Surface>
      <View style={[styles.collectionGrid, wide ? styles.collectionGridWide : undefined]}>
        {repeatedCards.map((card) => (
          <View key={card.key} style={[styles.collectionCard, { width: cardWidth }]}>
            <TarotCard
              compact
              face="up"
              faceUp={{
                artAltText: card.altText,
                cardName: card.name,
                ...(card.illustration === undefined ? {} : { illustration: card.illustration }),
                number: card.number,
                orientation: card.orientation,
                suitSymbol: card.suitSymbol,
              }}
              width={cardWidth}
            />
            <AppText numberOfLines={1} style={styles.cardName} variant="caption">
              {card.name}
            </AppText>
          </View>
        ))}
      </View>
      <StatusBanner
        message="Filter your reading history by intention, card, orientation, or date."
        title="A searchable reading archive"
      />
    </Screen>
  );
}

function OfferPreview({
  detail,
  eyebrow,
  price,
  title,
}: {
  detail: string;
  eyebrow: string;
  price: string;
  title: string;
}) {
  return (
    <Surface style={styles.offer}>
      <AppText color="gold" variant="caption">
        {eyebrow}
      </AppText>
      <AppText variant="headline">{title}</AppText>
      <AppText color="textMuted">{detail}</AppText>
      <AppButton label={price} onPress={noOp} />
    </Surface>
  );
}

function ShopPreview({ wide }: { wide: boolean }) {
  return (
    <Screen readingWidth={!wide}>
      <PreviewHeader eyebrow="Clear terms, no urgency" title="Choose how you reflect" />
      <StatusBanner
        message="Free readings are used first, then Oracle+, then pack credits."
        title="Your free daily reading stays included"
      />
      <View style={[styles.offers, wide ? styles.offersWide : undefined]}>
        <OfferPreview
          detail="Ten extra readings that remain until you use them. Purchase again only when you choose."
          eyebrow="One-time purchase · repeatable"
          price="One-time purchase"
          title="10-Reading Pack"
        />
        <OfferPreview
          detail="Ten readings every day while subscribed. Cancel any time in Apple subscription settings."
          eyebrow="Month-to-month subscription"
          price="Monthly subscription"
          title="Oracle+"
        />
      </View>
      <View style={styles.shopFooter}>
        <AppText color="textMuted" variant="caption">
          Apple shows your localized price before confirmation. Restore Purchases and Manage
          Subscription are always available in the app.
        </AppText>
      </View>
    </Screen>
  );
}

export default function ReleasePreviewScreen() {
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ screen?: string }>();
  const requested = typeof params.screen === 'string' ? params.screen : undefined;
  const preview = isPreviewName(requested) ? requested : 'oracle';
  const wide = width >= 700;

  if (!releaseCaptureMode) {
    return <Redirect href="/" />;
  }

  switch (preview) {
    case 'oracle':
      return <OraclePreview wide={wide} />;
    case 'reveal':
      return <RevealPreview wide={wide} />;
    case 'collection':
      return <CollectionPreview wide={wide} />;
    case 'shop':
      return <ShopPreview wide={wide} />;
  }
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  heroWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  cardColumn: {
    alignItems: 'center',
    gap: spacing.md,
  },
  featurePanel: {
    width: '100%',
    maxWidth: 520,
  },
  revealCopy: {
    flex: 1,
    width: '100%',
    maxWidth: 540,
    gap: spacing.md,
  },
  collectionSummary: {
    marginBottom: spacing.lg,
  },
  collectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  collectionGridWide: {
    justifyContent: 'center',
    gap: spacing.lg,
  },
  collectionCard: {
    gap: spacing.xxs,
  },
  cardName: {
    textAlign: 'center',
  },
  offers: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  offersWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  offer: {
    flex: 1,
    minWidth: 280,
  },
  shopFooter: {
    alignItems: 'center',
    borderTopColor: colors.goldMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
});
