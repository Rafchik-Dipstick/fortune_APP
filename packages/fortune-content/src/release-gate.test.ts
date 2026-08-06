import { describe, expect, it } from 'vitest';

import { fullDeckCards } from '../../../tools/card-assets/full-deck-catalog.mjs';
import assetManifest from '../../../tools/card-assets/manifest.json' with { type: 'json' };

import { createCanonicalDeck } from './canonical-deck.js';
import { developmentContentManifest } from './development-slice.js';
import {
  computeContentChecksum,
  crossCheckAssets,
  releaseGateExpectations,
  summarizeReleaseReadiness,
  validateReleaseManifest,
} from './release-gate.js';
import { contentManifestSchema, type ContentManifest } from './schema.js';

const developmentManifest = contentManifestSchema.parse(developmentContentManifest);
const canonicalDeck = createCanonicalDeck(fullDeckCards);

/** Builds a manifest that satisfies the whole gate, for the negative tests. */
function completeReleaseManifest(): ContentManifest {
  const cards = canonicalDeck.cards.map((card) => ({
    ...card,
    active: true,
    editorialStatus: 'APPROVED' as const,
  }));
  const templates = cards.flatMap((card) =>
    (['UPRIGHT', 'REVERSED'] as const).flatMap((orientation) =>
      (['GENERAL', 'LOVE', 'WORK', 'GROWTH'] as const).map((intention) => ({
        cardKey: card.key,
        locale: 'en' as const,
        orientation,
        intention,
        variant: 1,
        headline: `A quiet note for ${card.key} ${orientation.toLowerCase()}`,
        message: `${card.key} ${orientation} ${intention} reading. ${'This reflection invites you to notice one ordinary detail of the day and consider what it asks of your attention, without treating any of it as a fixed verdict about the future, and to hold the question lightly enough that your own judgement stays the deciding voice in whatever you choose next today. '.repeat(1)}${'Consider it gently. '.repeat(3)}`,
        action: `Spend a few unhurried minutes with ${card.key} and note one honest observation today.`,
        affirmation: `I meet ${card.key} ${intention.toLowerCase()} with care.`,
        contentVersion: 'release-test',
        editorialStatus: 'APPROVED' as const,
        active: true,
      })),
    ),
  );
  return contentManifestSchema.parse({
    schemaVersion: 1,
    contentVersion: 'release-test',
    locales: ['en'],
    cards,
    templates,
  });
}

describe('release readiness', () => {
  it('measures the development slice against the full-deck gate without throwing', () => {
    const readiness = summarizeReleaseReadiness(developmentManifest);

    expect(readiness.ready).toBe(false);
    expect(readiness.activeCards).toBe(3);
    expect(readiness.approvedTemplates).toBe(0);
    expect(readiness.readyForReviewTemplates).toBe(24);
    expect(readiness.requiredCombinations).toBe(624);
    // The three active cards contribute 24 unapproved combinations.
    expect(readiness.missingCombinations).toHaveLength(24);
    expect(readiness.blockers.join(' ')).toContain('78 active cards');
  });

  it('states the full-deck expectations the spec requires', () => {
    expect(releaseGateExpectations).toMatchObject({
      cards: 78,
      combinationsPerCardPerLocale: 8,
      minimumApprovedTemplates: 624,
      targetTemplates: 1248,
    });
  });

  it('accepts a complete, approved full-deck catalog', () => {
    const manifest = completeReleaseManifest();
    const readiness = summarizeReleaseReadiness(manifest);

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.approvedCards).toBe(78);
    expect(readiness.satisfiedCombinations).toBe(624);
    expect(validateReleaseManifest(manifest).templates).toHaveLength(624);
  });

  it('refuses a catalog whose templates are only ready for review', () => {
    const manifest = completeReleaseManifest();
    const pending = {
      ...manifest,
      templates: manifest.templates.map((template) => ({
        ...template,
        editorialStatus: 'READY_FOR_REVIEW' as const,
      })),
    };

    expect(summarizeReleaseReadiness(pending).ready).toBe(false);
    expect(() => validateReleaseManifest(pending)).toThrow(/approved/iu);
  });

  it('refuses a catalog with an unreviewed illustration description', () => {
    const manifest = completeReleaseManifest();
    const [first, ...rest] = manifest.cards;
    if (first === undefined) {
      throw new Error('The fixture manifest must contain cards.');
    }
    const unreviewed = {
      ...manifest,
      cards: [{ ...first, editorialStatus: 'READY_FOR_REVIEW' as const }, ...rest],
    };

    const readiness = summarizeReleaseReadiness(unreviewed);
    expect(readiness.cardsAwaitingReview).toEqual([first.key]);
    expect(() => validateReleaseManifest(unreviewed)).toThrow(/alternative text/iu);
  });

  it('names every combination a card is missing', () => {
    const manifest = completeReleaseManifest();
    const [dropped, ...keptTemplates] = manifest.templates;
    if (dropped === undefined) {
      throw new Error('The fixture manifest must contain templates.');
    }

    const readiness = summarizeReleaseReadiness({ ...manifest, templates: keptTemplates });
    expect(readiness.missingCombinations).toEqual([
      `${dropped.cardKey}:en:${dropped.orientation}:${dropped.intention}`,
    ]);
  });
});

describe('asset cross-check', () => {
  it('matches the canonical deck against the generated art manifest', () => {
    const result = crossCheckAssets(canonicalDeck.cards, assetManifest);

    expect(result.missingAssets).toEqual([]);
    expect(result.orphanedAssets).toEqual([]);
    expect(result.altTextMismatches).toEqual([]);
    expect(result.uncheckedAssets).toEqual([]);
    expect(result.consistent).toBe(true);
    // Visual review is a human gate; the whole deck is still outstanding.
    expect(result.unreviewedAssets).toHaveLength(78);
  });

  it('reports a card whose art is absent and art with no card', () => {
    const [firstAsset, ...restAssets] = assetManifest.cards;
    if (firstAsset === undefined) {
      throw new Error('The asset manifest must contain cards.');
    }
    const result = crossCheckAssets(canonicalDeck.cards, {
      ...assetManifest,
      cards: [...restAssets, { ...firstAsset, key: 'not-a-card' }],
    });

    expect(result.missingAssets).toEqual([firstAsset.key]);
    expect(result.orphanedAssets).toEqual(['not-a-card']);
    expect(result.consistent).toBe(false);
  });

  it('reports alt text that drifted between content and the art manifest', () => {
    const [firstAsset, ...restAssets] = assetManifest.cards;
    if (firstAsset === undefined) {
      throw new Error('The asset manifest must contain cards.');
    }
    const result = crossCheckAssets(canonicalDeck.cards, {
      ...assetManifest,
      cards: [
        {
          ...firstAsset,
          localizedAltText: { en: 'A different description of the same card art.' },
        },
        ...restAssets,
      ],
    });

    expect(result.altTextMismatches).toEqual([firstAsset.key]);
    expect(result.consistent).toBe(false);
  });
});

describe('content checksum', () => {
  it('is stable across manifest ordering', () => {
    const manifest = completeReleaseManifest();
    const reordered = {
      ...manifest,
      cards: [...manifest.cards].reverse(),
      templates: [...manifest.templates].reverse(),
    };

    expect(computeContentChecksum(reordered)).toBe(computeContentChecksum(manifest));
  });

  it('changes when any shipped word changes', () => {
    const manifest = completeReleaseManifest();
    const [first, ...rest] = manifest.templates;
    if (first === undefined) {
      throw new Error('The fixture manifest must contain templates.');
    }
    const edited = {
      ...manifest,
      templates: [{ ...first, affirmation: 'I notice one small thing today.' }, ...rest],
    };

    expect(computeContentChecksum(edited)).not.toBe(computeContentChecksum(manifest));
  });

  it('ignores editorial bookkeeping that never reaches a player', () => {
    const manifest = completeReleaseManifest();
    const [first, ...rest] = manifest.templates;
    if (first === undefined) {
      throw new Error('The fixture manifest must contain templates.');
    }
    const restatused = {
      ...manifest,
      templates: [{ ...first, editorialStatus: 'READY_FOR_REVIEW' as const }, ...rest],
    };

    expect(computeContentChecksum(restatused)).toBe(computeContentChecksum(manifest));
  });
});
