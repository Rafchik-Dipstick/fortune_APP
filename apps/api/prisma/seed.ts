import { PrismaPg } from '@prisma/adapter-pg';

import { fullDeckCards } from '../../../tools/card-assets/full-deck-catalog.mjs';
import {
  createCanonicalDeck,
  createReleaseContentManifest,
  developmentContentManifest,
  validateDevelopmentSlice,
  type ContentManifest,
  type TarotCardContent,
} from '@fortuneness/fortune-content';
import { seedContent } from '../src/content/content-seed.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * The full 78-card release catalog is what every environment gets. The Phase 2
 * three-card slice is still reachable, but only when it is asked for by name:
 * seeding it by default made a freshly provisioned database able to draw three
 * cards, which is the deck no one is building or testing.
 */
function resolveManifest(
  catalog: string | undefined,
  deckCards: readonly TarotCardContent[],
): ContentManifest {
  if (catalog === 'development') {
    return validateDevelopmentSlice(developmentContentManifest);
  }
  if (catalog !== undefined && catalog !== 'release') {
    throw new Error(
      `FORTUNE_CONTENT_CATALOG must be 'release' or 'development'; got '${catalog}'.`,
    );
  }
  return createReleaseContentManifest(deckCards);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required to seed Fortuneness.');
  }

  const canonicalDeck = createCanonicalDeck(fullDeckCards);
  const manifest = resolveManifest(process.env['FORTUNE_CONTENT_CATALOG'], canonicalDeck.cards);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const summary = await seedContent(prisma, {
      deckCards: canonicalDeck.cards,
      manifest,
    });
    process.stdout.write(
      [
        `Seeded ${String(summary.seededCards)} tarot cards (${String(summary.activeCards)} active)`,
        `and ${String(summary.templatesWritten)} templates at content version ${summary.contentVersion}.`,
        `Checksum ${summary.contentChecksum}.`,
        summary.supersededVersions.length === 0
          ? ''
          : `Superseded ${summary.supersededVersions.join(', ')}.`,
      ]
        .filter((part) => part.length > 0)
        .join(' '),
    );
    process.stdout.write('\n');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
