import { PrismaPg } from '@prisma/adapter-pg';

import { fullDeckCards } from '../../../tools/card-assets/full-deck-catalog.mjs';
import {
  createCanonicalDeck,
  developmentContentManifest,
  validateDevelopmentSlice,
} from '@fortuneness/fortune-content';
import { seedContent } from '../src/content/content-seed.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required to seed Fortuneness.');
  }

  const canonicalDeck = createCanonicalDeck(fullDeckCards);
  const manifest = validateDevelopmentSlice(developmentContentManifest);
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
