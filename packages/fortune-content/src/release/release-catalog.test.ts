import { describe, expect, it } from 'vitest';

import { fullDeckCards } from '../../../../tools/card-assets/full-deck-catalog.mjs';
import { createCanonicalDeck } from '../canonical-deck.js';
import { countWords } from '../schema.js';
import { summarizeReleaseReadiness } from '../release-gate.js';
import { authoredReleaseCards, createReleaseContentManifest } from './index.js';

const canonicalDeck = createCanonicalDeck(fullDeckCards);
const manifest = createReleaseContentManifest(canonicalDeck.cards);

describe('release catalog', () => {
  it('gives every authored card its full eight-combination matrix', () => {
    expect(manifest.templates).toHaveLength(authoredReleaseCards.length * 8);

    for (const authored of authoredReleaseCards) {
      const forCard = manifest.templates.filter(
        (template) => template.cardKey === authored.key && template.active,
      );
      expect(forCard).toHaveLength(8);
      expect(
        new Set(forCard.map((template) => `${template.orientation}:${template.intention}`)).size,
      ).toBe(8);
    }
  });

  it('activates only the cards that have authored copy', () => {
    const authoredKeys = new Set(authoredReleaseCards.map((authored) => authored.key));
    for (const card of manifest.cards) {
      expect(card.active).toBe(authoredKeys.has(card.key));
    }
  });

  it('keeps every reading inside the editorial length rubric', () => {
    for (const template of manifest.templates) {
      expect(countWords(template.headline)).toBeGreaterThanOrEqual(3);
      expect(countWords(template.headline)).toBeLessThanOrEqual(12);
      expect(countWords(template.message)).toBeGreaterThanOrEqual(50);
      expect(countWords(template.message)).toBeLessThanOrEqual(100);
      expect(countWords(template.action)).toBeGreaterThanOrEqual(10);
      expect(countWords(template.action)).toBeLessThanOrEqual(25);
      expect(countWords(template.affirmation)).toBeGreaterThanOrEqual(3);
      expect(countWords(template.affirmation)).toBeLessThanOrEqual(16);
    }
  });

  it('never self-approves authored copy', () => {
    // Approval is a human editorial act; the gate stays closed until then.
    for (const template of manifest.templates) {
      expect(template.editorialStatus).toBe('READY_FOR_REVIEW');
    }
    expect(summarizeReleaseReadiness(manifest).approvedTemplates).toBe(0);
  });

  it('reports authored coverage separately from approved coverage', () => {
    const readiness = summarizeReleaseReadiness(manifest);

    expect(readiness.authoredCombinations).toBe(authoredReleaseCards.length * 8);
    expect(readiness.satisfiedCombinations).toBe(0);
    expect(readiness.requiredCombinations).toBe(624);
    expect(readiness.ready).toBe(false);
  });

  it('authors each card exactly once, in canonical deck order', () => {
    const keys = authoredReleaseCards.map((authored) => authored.key);
    expect(new Set(keys).size).toBe(keys.length);

    const canonicalOrder = canonicalDeck.cards.map((card) => card.key);
    const authoredOrder = keys.map((key) => canonicalOrder.indexOf(key));
    expect(authoredOrder).toEqual([...authoredOrder].sort((left, right) => left - right));
    expect(authoredOrder.every((index) => index >= 0)).toBe(true);
  });

  it('rejects a card key that is not part of the canonical deck', () => {
    expect(() =>
      createReleaseContentManifest(
        canonicalDeck.cards.filter((card) => card.key !== 'major-00-fool'),
      ),
    ).toThrow(/major-00-fool/u);
  });
});
