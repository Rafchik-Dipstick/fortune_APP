import { contentManifestSchema, type ContentManifest, type TarotCardContent } from '../schema.js';
import {
  activateAuthoredCards,
  expandAuthoredCards,
  releaseContentVersion,
  type AuthoredCard,
} from './authoring.js';
import { majorArcanaCards } from './major-arcana.js';
import { wandsCards } from './wands.js';

/**
 * Every card whose eight English readings have been written. The list grows
 * card by card through the editorial workstream; the release gate reports the
 * distance to the full 78 on each run.
 */
export const authoredReleaseCards: readonly AuthoredCard[] = [...majorArcanaCards, ...wandsCards];

export { releaseContentVersion } from './authoring.js';
export type { AuthoredCard, CardReadings, Reading } from './authoring.js';

/**
 * Assembles the release catalog against the canonical deck. Only authored
 * cards are activated, so the manifest stays structurally valid at every
 * point during authoring rather than only when the last card lands.
 */
export function createReleaseContentManifest(
  deckCards: readonly TarotCardContent[],
): ContentManifest {
  const deckKeys = new Set(deckCards.map((deckCard) => deckCard.key));
  const authoredKeys = new Set<string>();

  for (const authored of authoredReleaseCards) {
    if (!deckKeys.has(authored.key)) {
      throw new Error(`Authored card ${authored.key} is not part of the canonical deck.`);
    }
    if (authoredKeys.has(authored.key)) {
      throw new Error(`Card ${authored.key} is authored more than once.`);
    }
    authoredKeys.add(authored.key);
  }

  return contentManifestSchema.parse({
    schemaVersion: 1,
    contentVersion: releaseContentVersion,
    locales: ['en'],
    cards: activateAuthoredCards(deckCards, authoredKeys),
    templates: expandAuthoredCards(authoredReleaseCards),
  });
}
