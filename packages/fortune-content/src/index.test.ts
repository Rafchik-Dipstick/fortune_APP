import { describe, expect, it } from 'vitest';

import { fullDeckCards } from '../../../tools/card-assets/full-deck-catalog.mjs';

import {
  contentManifestSchema,
  countWords,
  createCanonicalDeck,
  developmentContentManifest,
  developmentSliceExpectations,
  getTemplateReviewKey,
  renderEditorialReviewMarkdown,
  validateDevelopmentSlice,
} from './index.js';

describe('development fortune content', () => {
  it('builds the exact canonical 78-card deck from the art catalog', () => {
    const deck = createCanonicalDeck(fullDeckCards);

    expect(deck.cards).toHaveLength(78);
    expect(deck.cards.filter(({ arcana }) => arcana === 'MAJOR')).toHaveLength(22);
    expect(deck.cards.filter(({ arcana }) => arcana === 'MINOR')).toHaveLength(56);
    expect(deck.cards.map(({ sortOrder }) => sortOrder)).toEqual(
      Array.from({ length: 78 }, (_, index) => index),
    );
    expect(deck.cards.find(({ key }) => key === 'cups-queen')?.sortOrder).toBe(48);
  });

  it('contains the complete three-card and 24-template matrix', () => {
    const manifest = validateDevelopmentSlice(developmentContentManifest);

    expect(manifest.cards).toHaveLength(developmentSliceExpectations.cards);
    expect(manifest.templates).toHaveLength(developmentSliceExpectations.templates);
    expect(new Set(manifest.cards.map(({ sliceRole }) => sliceRole))).toEqual(
      new Set(['MAJOR', 'COURT', 'PIP']),
    );
  });

  it('keeps message, action, and English alt-text lengths inside the rubric', () => {
    const manifest = validateDevelopmentSlice(developmentContentManifest);

    for (const template of manifest.templates) {
      expect(countWords(template.message)).toBeGreaterThanOrEqual(50);
      expect(countWords(template.message)).toBeLessThanOrEqual(100);
      expect(countWords(template.action)).toBeGreaterThanOrEqual(10);
      expect(countWords(template.action)).toBeLessThanOrEqual(25);
    }

    for (const card of manifest.cards) {
      expect(countWords(card.localizedAltText.en)).toBeGreaterThanOrEqual(8);
      expect(countWords(card.localizedAltText.en)).toBeLessThanOrEqual(25);
    }
  });

  it('rejects a missing orientation and intention combination', () => {
    const result = contentManifestSchema.safeParse({
      ...developmentContentManifest,
      templates: developmentContentManifest.templates.slice(1),
    });

    expect(result.success).toBe(false);
  });

  it('rejects harmful or absolute phrasing', () => {
    const [firstTemplate, ...remainingTemplates] = developmentContentManifest.templates;
    expect(firstTemplate).toBeDefined();

    if (!firstTemplate) {
      return;
    }

    const result = contentManifestSchema.safeParse({
      ...developmentContentManifest,
      templates: [
        {
          ...firstTemplate,
          message:
            'This reading definitely guarantees a fixed result, regardless of context or choice. The surrounding details cannot change what has already been decided. Treat the message as final proof and ignore any uncertainty that appears. No further reflection is needed because the outcome is inevitable, complete, and beyond reconsideration from this moment onward.',
        },
        ...remainingTemplates,
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects incomplete alternative text', () => {
    const [firstCard, ...remainingCards] = developmentContentManifest.cards;
    expect(firstCard).toBeDefined();

    if (!firstCard) {
      return;
    }

    const result = contentManifestSchema.safeParse({
      ...developmentContentManifest,
      cards: [
        {
          ...firstCard,
          localizedAltText: { en: 'A traveler.' },
        },
        ...remainingCards,
      ],
    });

    expect(result.success).toBe(false);
  });

  it('renders one deterministic review block for every logical template key', () => {
    const manifest = validateDevelopmentSlice(developmentContentManifest);
    const report = renderEditorialReviewMarkdown(manifest);

    expect(report.match(/\*\*Review key:\*\*/gu)).toHaveLength(
      developmentSliceExpectations.templates,
    );
    for (const template of manifest.templates) {
      expect(report).toContain(`\`${getTemplateReviewKey(template)}\``);
    }
    expect(renderEditorialReviewMarkdown(manifest)).toBe(report);
  });

  it('orders review sections by canonical card sort order', () => {
    const manifest = validateDevelopmentSlice(developmentContentManifest);
    const report = renderEditorialReviewMarkdown(manifest);

    expect(report.indexOf('## The Fool')).toBeLessThan(report.indexOf('## Three of Wands'));
    expect(report.indexOf('## Three of Wands')).toBeLessThan(report.indexOf('## Queen of Cups'));
  });
});
