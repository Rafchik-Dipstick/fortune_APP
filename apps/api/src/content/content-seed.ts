import {
  computeContentChecksum,
  contentManifestSchema,
  type ContentManifest,
  type TarotCardContent,
} from '@fortuneness/fortune-content';

import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';

export interface ContentSeedInput {
  /** Canonical card metadata; the manifest decides which of these ship. */
  deckCards: readonly TarotCardContent[];
  manifest: ContentManifest;
}

export interface ContentSeedSummary {
  activeCards: number;
  contentChecksum: string;
  contentVersion: string;
  seededCards: number;
  supersededVersions: string[];
  templatesWritten: number;
}

function assertManifestCardMatchesCanonical(
  manifestCard: TarotCardContent,
  canonicalCard: TarotCardContent,
): void {
  const comparable = (card: TarotCardContent) => ({
    key: card.key,
    displayNumber: card.displayNumber,
    arcana: card.arcana,
    suit: card.suit,
    rank: card.rank,
    assetKey: card.assetKey,
    localizedName: card.localizedName,
    localizedAltText: card.localizedAltText,
    sortOrder: card.sortOrder,
  });

  if (JSON.stringify(comparable(manifestCard)) !== JSON.stringify(comparable(canonicalCard))) {
    throw new Error(`Manifest metadata diverges from the canonical deck for ${canonicalCard.key}.`);
  }
}

async function seedCards(
  transaction: Prisma.TransactionClient,
  input: ContentSeedInput,
): Promise<number> {
  const manifestCards = new Map(input.manifest.cards.map((card) => [card.key, card] as const));

  for (const card of input.deckCards) {
    const manifestCard = manifestCards.get(card.key);
    if (manifestCard !== undefined) {
      assertManifestCardMatchesCanonical(manifestCard, card);
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
      active: manifestCard?.active ?? false,
    };

    await transaction.tarotCard.upsert({
      where: { key: card.key },
      create: { key: card.key, ...data },
      update: data,
    });
  }

  return input.manifest.cards.filter((card) => card.active).length;
}

/**
 * Versioned, additive template seeding (spec section 5.6 and Phase 11).
 *
 * Copy is written only for the manifest's own `contentVersion`. Rows from an
 * earlier version are deactivated so selection stops choosing them, but their
 * words are never rewritten and no row is ever deleted — a `FortuneDraw`
 * references its template by id and would otherwise be orphaned. Draw rows
 * are never touched here, and each one carries immutable snapshot columns, so
 * re-seeding a production-like database cannot change a reading a player has
 * already been shown.
 */
async function seedTemplates(
  transaction: Prisma.TransactionClient,
  manifest: ContentManifest,
): Promise<{ supersededVersions: string[]; templatesWritten: number }> {
  const version = manifest.contentVersion;
  const writtenIds: string[] = [];

  // A partial unique index allows only one active row per logical variant, so
  // an older release must be retired before the new one becomes active. Only
  // the `active` flag changes; the retired words stay exactly as published.
  const superseded = await transaction.fortuneTemplate.findMany({
    where: { active: true, contentVersion: { not: version } },
    distinct: ['contentVersion'],
    select: { contentVersion: true },
  });
  if (superseded.length > 0) {
    await transaction.fortuneTemplate.updateMany({
      where: { active: true, contentVersion: { not: version } },
      data: { active: false },
    });
  }

  for (const template of manifest.templates) {
    if (template.contentVersion !== version) {
      throw new Error(
        `Template ${template.cardKey}:${template.orientation}:${template.intention} declares content version ${template.contentVersion}, but the manifest is ${version}.`,
      );
    }
    const logicalKey = {
      cardKey: template.cardKey,
      locale: template.locale,
      orientation: template.orientation,
      intention: template.intention,
      variant: template.variant,
      contentVersion: version,
    };
    const copy = {
      headline: template.headline,
      message: template.message,
      gentleAction: template.action,
      affirmation: template.affirmation,
      active: template.active,
    };

    const written = await transaction.fortuneTemplate.upsert({
      where: { cardKey_locale_orientation_intention_variant_contentVersion: logicalKey },
      create: { ...logicalKey, ...copy },
      update: copy,
    });
    writtenIds.push(written.id);
  }

  // Rows this version no longer ships are retired, never edited or deleted.
  await transaction.fortuneTemplate.updateMany({
    where: { contentVersion: version, active: true, id: { notIn: writtenIds } },
    data: { active: false },
  });

  return {
    supersededVersions: superseded.map((template) => template.contentVersion).sort(),
    templatesWritten: manifest.templates.length,
  };
}

export async function seedContent(
  prisma: PrismaClient,
  input: ContentSeedInput,
): Promise<ContentSeedSummary> {
  const manifest = contentManifestSchema.parse(input.manifest);
  return prisma.$transaction(async (transaction) => {
    const activeCards = await seedCards(transaction, { ...input, manifest });
    const templates = await seedTemplates(transaction, manifest);
    return {
      activeCards,
      contentChecksum: computeContentChecksum(manifest),
      contentVersion: manifest.contentVersion,
      seededCards: input.deckCards.length,
      ...templates,
    };
  });
}
