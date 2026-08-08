import { randomUUID } from 'node:crypto';

import {
  computeContentChecksum,
  contentManifestSchema,
  type ContentManifest,
  type TarotCardContent,
} from '@fortuneness/fortune-content';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

/**
 * Rows per statement. The catalog is written with multi-row `INSERT … ON
 * CONFLICT` rather than one upsert per row: at 78 cards and 624 templates the
 * per-row form costs 702 round trips, which is imperceptible against a
 * loopback database and roughly two minutes against a deployed one over the
 * public proxy — long enough to exceed any sane transaction budget and to hold
 * locks on the content tables for the whole time. Chunking keeps each
 * statement well inside PostgreSQL's 65535 bound parameters.
 */
const insertChunkSize = 200;

function chunk<Item>(items: readonly Item[], size: number): Item[][] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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

  const values = input.deckCards.map((card) => {
    const manifestCard = manifestCards.get(card.key);
    if (manifestCard !== undefined) {
      assertManifestCardMatchesCanonical(manifestCard, card);
    }

    return Prisma.sql`(
      ${card.key},
      ${card.displayNumber},
      ${card.localizedName.en},
      ${card.arcana}::"Arcana",
      ${card.suit ?? null}::"TarotSuit",
      ${card.rank ?? null}::"TarotRank",
      ${card.assetKey},
      ${card.localizedAltText.en},
      ${card.sortOrder},
      ${manifestCard?.active ?? false},
      now()
    )`;
  });

  for (const group of chunk(values, insertChunkSize)) {
    await transaction.$executeRaw`
      INSERT INTO "TarotCard" (
        "key", "displayNumber", "nameEn", "arcana", "suit", "rank",
        "assetKey", "illustrationAltEn", "sortOrder", "active", "updatedAt"
      )
      VALUES ${Prisma.join(group)}
      ON CONFLICT ("key") DO UPDATE SET
        "displayNumber" = EXCLUDED."displayNumber",
        "nameEn" = EXCLUDED."nameEn",
        "arcana" = EXCLUDED."arcana",
        "suit" = EXCLUDED."suit",
        "rank" = EXCLUDED."rank",
        "assetKey" = EXCLUDED."assetKey",
        "illustrationAltEn" = EXCLUDED."illustrationAltEn",
        "sortOrder" = EXCLUDED."sortOrder",
        "active" = EXCLUDED."active",
        "updatedAt" = now()`;
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

  const values = manifest.templates.map((template) => {
    if (template.contentVersion !== version) {
      throw new Error(
        `Template ${template.cardKey}:${template.orientation}:${template.intention} declares content version ${template.contentVersion}, but the manifest is ${version}.`,
      );
    }

    // Supplied rather than defaulted: `id` carries Prisma's client-side
    // `uuid()` default, which a raw insert never reaches. A row that already
    // exists keeps its own id, because ON CONFLICT DO UPDATE never rewrites it
    // — the id a `FortuneDraw` references stays stable across re-seeds.
    return Prisma.sql`(
      ${randomUUID()}::uuid,
      ${template.cardKey},
      ${template.locale},
      ${template.orientation}::"Orientation",
      ${template.intention}::"FortuneIntention",
      ${template.variant},
      ${template.headline},
      ${template.message},
      ${template.action},
      ${template.affirmation},
      ${version},
      ${template.active},
      now()
    )`;
  });

  for (const group of chunk(values, insertChunkSize)) {
    const written = await transaction.$queryRaw<{ id: string }[]>`
      INSERT INTO "FortuneTemplate" (
        "id", "cardKey", "locale", "orientation", "intention", "variant",
        "headline", "message", "gentleAction", "affirmation", "contentVersion",
        "active", "updatedAt"
      )
      VALUES ${Prisma.join(group)}
      ON CONFLICT ("cardKey", "locale", "orientation", "intention", "variant", "contentVersion")
      DO UPDATE SET
        "headline" = EXCLUDED."headline",
        "message" = EXCLUDED."message",
        "gentleAction" = EXCLUDED."gentleAction",
        "affirmation" = EXCLUDED."affirmation",
        "active" = EXCLUDED."active",
        "updatedAt" = now()
      RETURNING "id"`;
    writtenIds.push(...written.map((row) => row.id));
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
  return prisma.$transaction(
    async (transaction) => {
      const activeCards = await seedCards(transaction, { ...input, manifest });
      const templates = await seedTemplates(transaction, manifest);
      return {
        activeCards,
        contentChecksum: computeContentChecksum(manifest),
        contentVersion: manifest.contentVersion,
        seededCards: input.deckCards.length,
        ...templates,
      };
    },
    // The whole catalog is one transaction on purpose: a partially seeded deck
    // is worse than an unseeded one. Batched inserts bring that to a handful of
    // statements, but the budget still has to cover an operator seeding a
    // deployed database across the public proxy, where each round trip costs
    // orders of magnitude more than on loopback. Prisma's 5-second default does
    // not.
    { maxWait: 15_000, timeout: 60_000 },
  );
}
