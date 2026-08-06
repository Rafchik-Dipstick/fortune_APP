import { type FortuneTemplate, type TarotCardContent } from '../schema.js';

export const releaseContentVersion = 'full-deck-en-v1';

/**
 * One reading: headline, message, gentle action, affirmation. Word bounds are
 * enforced by `fortuneTemplateSchema` (3–12 / 50–100 / 10–25 / 3–16), and
 * every reading must be individually written — normalized copy is unique
 * across the whole catalog, so no template can be a reworded twin.
 */
export type Reading = readonly [
  headline: string,
  message: string,
  action: string,
  affirmation: string,
];

export interface CardReadings {
  REVERSED: OrientationReadings;
  UPRIGHT: OrientationReadings;
}

interface OrientationReadings {
  GENERAL: Reading;
  GROWTH: Reading;
  LOVE: Reading;
  WORK: Reading;
}

export interface AuthoredCard {
  key: string;
  readings: CardReadings;
}

const orientations = ['UPRIGHT', 'REVERSED'] as const;
const intentions = ['GENERAL', 'LOVE', 'WORK', 'GROWTH'] as const;

export function card(key: string, readings: CardReadings): AuthoredCard {
  return { key, readings };
}

/** Expands authored cards into the eight templates each one owes. */
export function expandAuthoredCards(cards: readonly AuthoredCard[]): FortuneTemplate[] {
  const templates: FortuneTemplate[] = [];
  for (const authored of cards) {
    for (const orientation of orientations) {
      for (const intention of intentions) {
        const [headline, message, action, affirmation] = authored.readings[orientation][intention];
        templates.push({
          cardKey: authored.key,
          locale: 'en',
          orientation,
          intention,
          variant: 1,
          headline,
          message,
          action,
          affirmation,
          contentVersion: releaseContentVersion,
          // Authored copy is never self-approved. A human editorial pass moves
          // these to APPROVED, which is what the release gate requires.
          editorialStatus: 'READY_FOR_REVIEW',
          active: true,
        });
      }
    }
  }
  return templates;
}

/**
 * Activates exactly the cards whose eight readings exist. A card with no
 * authored copy stays inactive, so the catalog parses at every point during
 * the editorial workstream instead of only when the last card lands.
 */
export function activateAuthoredCards(
  deckCards: readonly TarotCardContent[],
  authoredKeys: ReadonlySet<string>,
): TarotCardContent[] {
  return deckCards.map((deckCard) =>
    authoredKeys.has(deckCard.key)
      ? { ...deckCard, active: true, editorialStatus: 'READY_FOR_REVIEW' as const }
      : { ...deckCard, active: false },
  );
}
