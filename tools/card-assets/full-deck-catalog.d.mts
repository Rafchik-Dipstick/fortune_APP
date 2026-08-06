export interface FullDeckSourceCard {
  altText: string;
  group: 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';
  key: string;
  name: string;
  scene: string;
}

export const fullDeckPromptTemplateVersion: string;
export const fullDeckCards: readonly FullDeckSourceCard[];
export function createFullDeckPrompt(deckCard: FullDeckSourceCard): string;
