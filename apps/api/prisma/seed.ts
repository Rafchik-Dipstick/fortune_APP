import { PrismaPg } from '@prisma/adapter-pg';
import { fullDeckCards } from '../../../tools/card-assets/full-deck-catalog.mjs';
import {
  createCanonicalDeck,
  developmentContentManifest,
  validateDevelopmentSlice,
  type TarotCardContent,
} from '../../../packages/fortune-content/src/index.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

const developmentManifest = validateDevelopmentSlice(developmentContentManifest);
const canonicalDeck = createCanonicalDeck(fullDeckCards);

function assertDevelopmentCardMatchesCanonical(
  developmentCard: TarotCardContent,
  canonicalCard: TarotCardContent,
): void {
  const comparableDevelopment = {
    key: developmentCard.key,
    displayNumber: developmentCard.displayNumber,
    arcana: developmentCard.arcana,
    suit: developmentCard.suit,
    rank: developmentCard.rank,
    assetKey: developmentCard.assetKey,
    localizedName: developmentCard.localizedName,
    localizedAltText: developmentCard.localizedAltText,
    sortOrder: developmentCard.sortOrder,
  };
  const comparableCanonical = {
    key: canonicalCard.key,
    displayNumber: canonicalCard.displayNumber,
    arcana: canonicalCard.arcana,
    suit: canonicalCard.suit,
    rank: canonicalCard.rank,
    assetKey: canonicalCard.assetKey,
    localizedName: canonicalCard.localizedName,
    localizedAltText: canonicalCard.localizedAltText,
    sortOrder: canonicalCard.sortOrder,
  };

  if (JSON.stringify(comparableDevelopment) !== JSON.stringify(comparableCanonical)) {
    throw new Error(
      `Development metadata diverges from the canonical deck for ${canonicalCard.key}.`,
    );
  }
}

async function seedCards(transaction: Prisma.TransactionClient): Promise<void> {
  const developmentCards = new Map(
    developmentManifest.cards.map((card) => [card.key, card] as const),
  );

  for (const card of canonicalDeck.cards) {
    const developmentCard = developmentCards.get(card.key);
    if (developmentCard !== undefined) {
      assertDevelopmentCardMatchesCanonical(developmentCard, card);
    }

    const data = {
      displayNumber: card.displayNumber,
      nameEn: card.localizedName.en,
      arcana: card.arcana,
      suit: card.suit ?? null,
      rank: card.rank ?? null,
      assetKey: card.assetKey,
      illustrationAltEn: card.localizedAltText.en,
      sortOrder: card.sortOrder,
      active: developmentCard !== undefined,
    };

    await transaction.tarotCard.upsert({
      where: { key: card.key },
      create: { key: card.key, ...data },
      update: data,
    });
  }
}

async function seedTemplates(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.fortuneTemplate.updateMany({
    where: { contentVersion: developmentManifest.contentVersion, active: true },
    data: { active: false },
  });

  for (const template of developmentManifest.templates) {
    const logicalKey = {
      cardKey: template.cardKey,
      locale: template.locale,
      orientation: template.orientation,
      intention: template.intention,
      variant: template.variant,
      contentVersion: template.contentVersion,
    };
    const copy = {
      headline: template.headline,
      message: template.message,
      gentleAction: template.action,
      affirmation: template.affirmation,
      active: template.active,
    };

    await transaction.fortuneTemplate.upsert({
      where: { cardKey_locale_orientation_intention_variant_contentVersion: logicalKey },
      create: { ...logicalKey, ...copy },
      update: copy,
    });
  }
}

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await seedCards(transaction);
    await seedTemplates(transaction);
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required to seed Fortuneness.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    await seedDatabase(prisma);
    process.stdout.write(
      `Seeded ${String(canonicalDeck.cards.length)} tarot cards and ${String(developmentManifest.templates.length)} development templates.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
