import { z } from 'zod';

import { contentSchemaVersion, tarotCardSchema, type TarotCardContent } from './schema.js';

export const canonicalDeckVersion = 'full-deck-v1' as const;

const majorDisplayNumbers = [
  '0',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
  'XXI',
] as const;

const suits = ['wands', 'cups', 'swords', 'pentacles'] as const;
type Suit = (typeof suits)[number];
const suitValues = {
  wands: 'WANDS',
  cups: 'CUPS',
  swords: 'SWORDS',
  pentacles: 'PENTACLES',
} as const satisfies Record<Suit, string>;
const rankDefinitions = [
  ['ace', 'ACE', 'A'],
  ['02', 'TWO', 'II'],
  ['03', 'THREE', 'III'],
  ['04', 'FOUR', 'IV'],
  ['05', 'FIVE', 'V'],
  ['06', 'SIX', 'VI'],
  ['07', 'SEVEN', 'VII'],
  ['08', 'EIGHT', 'VIII'],
  ['09', 'NINE', 'IX'],
  ['10', 'TEN', 'X'],
  ['page', 'PAGE', 'P'],
  ['knight', 'KNIGHT', 'N'],
  ['queen', 'QUEEN', 'Q'],
  ['king', 'KING', 'K'],
] as const;

const deckSourceCardSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    name: z.string().trim().min(1),
    group: z.enum(['major', ...suits]),
    scene: z.string().trim().min(1),
    altText: z.string().trim().min(1),
  })
  .strict();

const expectedKeys = [
  'major-00-fool',
  'major-01-magician',
  'major-02-high-priestess',
  'major-03-empress',
  'major-04-emperor',
  'major-05-hierophant',
  'major-06-lovers',
  'major-07-chariot',
  'major-08-strength',
  'major-09-hermit',
  'major-10-wheel-of-fortune',
  'major-11-justice',
  'major-12-hanged-man',
  'major-13-death',
  'major-14-temperance',
  'major-15-devil',
  'major-16-tower',
  'major-17-star',
  'major-18-moon',
  'major-19-sun',
  'major-20-judgement',
  'major-21-world',
  ...suits.flatMap((suit) => rankDefinitions.map(([keyRank]) => `${suit}-${keyRank}`)),
] as const;

export const canonicalDeckSchema = z
  .object({
    schemaVersion: z.literal(contentSchemaVersion),
    deckVersion: z.literal(canonicalDeckVersion),
    locale: z.literal('en'),
    cards: z.array(tarotCardSchema).length(78),
  })
  .strict()
  .superRefine(({ cards }, context) => {
    const keys = cards.map(({ key }) => key);
    const sortOrders = cards.map(({ sortOrder }) => sortOrder);

    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'Canonical deck contains duplicate card keys.' });
    }

    if (new Set(sortOrders).size !== sortOrders.length) {
      context.addIssue({
        code: 'custom',
        message: 'Canonical deck contains duplicate sort orders.',
      });
    }

    for (const [index, expectedKey] of expectedKeys.entries()) {
      const card = cards[index];
      const expectedSortOrder = index;
      if (card?.key !== expectedKey || card.sortOrder !== expectedSortOrder) {
        context.addIssue({
          code: 'custom',
          message: `Expected ${expectedKey} at sort order ${String(expectedSortOrder)}.`,
          path: ['cards', index],
        });
      }
    }
  });

export interface DeckSourceCard {
  altText: string;
  group: 'major' | Suit;
  key: string;
  name: string;
  scene: string;
}

export type CanonicalDeck = z.infer<typeof canonicalDeckSchema>;

function createMajorCard(source: DeckSourceCard, sortOrder: number): TarotCardContent {
  const displayNumber = majorDisplayNumbers[sortOrder];
  if (displayNumber === undefined) {
    throw new Error(`Major Arcana sort order is out of range: ${String(sortOrder)}.`);
  }

  return {
    key: source.key,
    displayNumber,
    arcana: 'MAJOR',
    sliceRole: 'MAJOR',
    assetKey: source.key,
    localizedName: { en: source.name },
    localizedAltText: { en: source.altText },
    localizedIllustrationDescription: { en: source.scene },
    editorialStatus: 'DRAFT',
    sortOrder,
    active: false,
  };
}

function createMinorCard(source: DeckSourceCard, sortOrder: number): TarotCardContent {
  if (source.group === 'major') {
    throw new Error(`Expected a Minor Arcana group for ${source.key}.`);
  }

  const keyRank = source.key.slice(source.group.length + 1);
  const definition = rankDefinitions.find(([candidate]) => candidate === keyRank);
  if (definition === undefined) {
    throw new Error(`Unknown Minor Arcana rank in ${source.key}.`);
  }

  const [, rank, displayNumber] = definition;
  return {
    key: source.key,
    displayNumber,
    arcana: 'MINOR',
    sliceRole: ['PAGE', 'KNIGHT', 'QUEEN', 'KING'].includes(rank) ? 'COURT' : 'PIP',
    suit: suitValues[source.group],
    rank,
    assetKey: source.key,
    localizedName: { en: source.name },
    localizedAltText: { en: source.altText },
    localizedIllustrationDescription: { en: source.scene },
    editorialStatus: 'DRAFT',
    sortOrder,
    active: false,
  };
}

export function createCanonicalDeck(value: unknown): CanonicalDeck {
  const sources = z.array(deckSourceCardSchema).length(78).parse(value);
  const cards = sources.map((source, sortOrder) =>
    source.group === 'major'
      ? createMajorCard(source, sortOrder)
      : createMinorCard(source, sortOrder),
  );

  return canonicalDeckSchema.parse({
    schemaVersion: contentSchemaVersion,
    deckVersion: canonicalDeckVersion,
    locale: 'en',
    cards,
  });
}
