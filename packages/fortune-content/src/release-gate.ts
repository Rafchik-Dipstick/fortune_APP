import { createHash } from 'node:crypto';

import {
  contentManifestSchema,
  launchLocales,
  type ContentManifest,
  type FortuneTemplate,
  type TarotCardContent,
} from './schema.js';

const orientations = ['UPRIGHT', 'REVERSED'] as const;
const intentions = ['GENERAL', 'LOVE', 'WORK', 'GROWTH'] as const;

/**
 * Phase 11 release thresholds. Every English combination of the full deck
 * must exist and be editorially approved before the catalog can ship; the
 * target doubles that to give the selection engine a second variant.
 */
export const releaseGateExpectations = {
  cards: 78,
  combinationsPerCardPerLocale: orientations.length * intentions.length,
  minimumApprovedTemplates: 78 * orientations.length * intentions.length,
  targetTemplates: 78 * orientations.length * intentions.length * 2,
} as const;

export interface ReleaseReadiness {
  activeCards: number;
  activeTemplates: number;
  approvedCards: number;
  approvedTemplates: number;
  /** Card keys whose illustration description and alt text are not approved. */
  cardsAwaitingReview: string[];
  /** `cardKey:locale:orientation:intention` keys with no approved template. */
  missingCombinations: string[];
  ready: boolean;
  readyForReviewTemplates: number;
  requiredCombinations: number;
  satisfiedCombinations: number;
  /** Human-readable reasons the catalog cannot ship yet. */
  blockers: string[];
}

function combinationKey(
  cardKey: string,
  locale: string,
  orientation: string,
  intention: string,
): string {
  return `${cardKey}:${locale}:${orientation}:${intention}`;
}

function approvedCombinationKeys(templates: readonly FortuneTemplate[]): Set<string> {
  const keys = new Set<string>();
  for (const template of templates) {
    if (template.active && template.editorialStatus === 'APPROVED') {
      keys.add(
        combinationKey(template.cardKey, template.locale, template.orientation, template.intention),
      );
    }
  }
  return keys;
}

/**
 * Reports exactly how far the catalog is from the release gate. This is the
 * progress view the editorial workstream reads; it never throws, so partial
 * catalogs can be measured on every commit.
 */
export function summarizeReleaseReadiness(manifest: ContentManifest): ReleaseReadiness {
  const activeCards = manifest.cards.filter((card) => card.active);
  const activeTemplates = manifest.templates.filter((template) => template.active);
  const approved = approvedCombinationKeys(manifest.templates);
  const cardsAwaitingReview = activeCards
    .filter((card) => card.editorialStatus !== 'APPROVED')
    .map((card) => card.key);

  const missingCombinations: string[] = [];
  for (const card of activeCards) {
    for (const locale of manifest.locales) {
      for (const orientation of orientations) {
        for (const intention of intentions) {
          const key = combinationKey(card.key, locale, orientation, intention);
          if (!approved.has(key)) {
            missingCombinations.push(key);
          }
        }
      }
    }
  }

  const requiredCombinations =
    releaseGateExpectations.cards *
    manifest.locales.length *
    releaseGateExpectations.combinationsPerCardPerLocale;
  const satisfiedCombinations = approved.size;
  const approvedTemplates = manifest.templates.filter(
    (template) => template.active && template.editorialStatus === 'APPROVED',
  ).length;

  const blockers: string[] = [];
  if (activeCards.length !== releaseGateExpectations.cards) {
    blockers.push(
      `The release needs ${String(releaseGateExpectations.cards)} active cards; ${String(activeCards.length)} are active.`,
    );
  }
  if (cardsAwaitingReview.length > 0) {
    blockers.push(
      `${String(cardsAwaitingReview.length)} active cards have an unapproved illustration description or alternative text.`,
    );
  }
  if (missingCombinations.length > 0) {
    blockers.push(
      `${String(missingCombinations.length)} English combinations have no approved active template.`,
    );
  }
  if (approvedTemplates < releaseGateExpectations.minimumApprovedTemplates) {
    blockers.push(
      `The release needs at least ${String(releaseGateExpectations.minimumApprovedTemplates)} approved templates; ${String(approvedTemplates)} are approved.`,
    );
  }

  return {
    activeCards: activeCards.length,
    activeTemplates: activeTemplates.length,
    approvedCards: activeCards.length - cardsAwaitingReview.length,
    approvedTemplates,
    blockers,
    cardsAwaitingReview,
    missingCombinations,
    ready: blockers.length === 0,
    readyForReviewTemplates: manifest.templates.filter(
      (template) => template.editorialStatus === 'READY_FOR_REVIEW',
    ).length,
    requiredCombinations,
    satisfiedCombinations,
  };
}

/**
 * Release gate. Structural validation still runs first, so a manifest that
 * passes here is both internally consistent and editorially complete.
 */
export function validateReleaseManifest(value: unknown): ContentManifest {
  const manifest = contentManifestSchema.parse(value);
  const readiness = summarizeReleaseReadiness(manifest);
  if (!readiness.ready) {
    throw new Error(
      `The content release gate is not satisfied:\n- ${readiness.blockers.join('\n- ')}`,
    );
  }
  return manifest;
}

interface AssetManifestCard {
  bundledPath?: string;
  key: string;
  localizedAltText?: { en?: string };
  reviewStatus?: string;
  sha256?: string;
}

export interface AssetManifestShape {
  cards: readonly AssetManifestCard[];
  expectedCardCount: number;
  normalizationVersion?: string;
}

export interface AssetCrossCheck {
  /** Cards whose alt text differs between content and the asset manifest. */
  altTextMismatches: string[];
  /** Content asset keys with no manifest entry. */
  missingAssets: string[];
  /** Manifest entries with no content card. */
  orphanedAssets: string[];
  /** Manifest entries with no recorded sha256 checksum. */
  uncheckedAssets: string[];
  /** Manifest entries not yet marked reviewed. */
  unreviewedAssets: string[];
  consistent: boolean;
}

/**
 * Cross-checks the content catalog against the generated card-art manifest.
 * Content owns the words, the asset manifest owns the pixels and checksums,
 * and a release requires the two to describe the same 78 cards.
 */
export function crossCheckAssets(
  cards: readonly TarotCardContent[],
  assetManifest: AssetManifestShape,
): AssetCrossCheck {
  const assetsByKey = new Map(assetManifest.cards.map((card) => [card.key, card]));
  const contentKeys = new Set(cards.map((card) => card.assetKey));

  const altTextMismatches: string[] = [];
  const missingAssets: string[] = [];
  const uncheckedAssets: string[] = [];
  const unreviewedAssets: string[] = [];

  for (const card of cards) {
    const asset = assetsByKey.get(card.assetKey);
    if (asset === undefined) {
      missingAssets.push(card.assetKey);
      continue;
    }
    if (asset.sha256?.length !== 64) {
      uncheckedAssets.push(card.assetKey);
    }
    if (asset.reviewStatus !== 'REVIEWED') {
      unreviewedAssets.push(card.assetKey);
    }
    if (
      asset.localizedAltText?.en !== undefined &&
      asset.localizedAltText.en !== card.localizedAltText.en
    ) {
      altTextMismatches.push(card.assetKey);
    }
  }

  const orphanedAssets = assetManifest.cards
    .map((asset) => asset.key)
    .filter((key) => !contentKeys.has(key));

  return {
    altTextMismatches,
    consistent:
      altTextMismatches.length === 0 && missingAssets.length === 0 && orphanedAssets.length === 0,
    missingAssets,
    orphanedAssets,
    uncheckedAssets,
    unreviewedAssets,
  };
}

/**
 * Stable checksum of everything a seed would write. Two manifests with the
 * same checksum produce the same catalog, which is what makes a content
 * version meaningful across environments.
 */
export function computeContentChecksum(manifest: ContentManifest): string {
  const cards = [...manifest.cards]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((card) => [
      card.key,
      card.displayNumber,
      card.arcana,
      card.suit ?? '',
      card.rank ?? '',
      card.assetKey,
      card.localizedName.en,
      card.localizedAltText.en,
      card.localizedIllustrationDescription.en,
      String(card.sortOrder),
      String(card.active),
    ]);
  const templates = [...manifest.templates]
    .map((template) => [
      template.cardKey,
      template.locale,
      template.orientation,
      template.intention,
      String(template.variant),
      template.headline,
      template.message,
      template.action,
      template.affirmation,
      String(template.active),
    ])
    .sort((left, right) => left.join(' ').localeCompare(right.join(' ')));

  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: manifest.schemaVersion,
        contentVersion: manifest.contentVersion,
        locales: [...manifest.locales].sort(),
        cards,
        templates,
      }),
    )
    .digest('hex');
}

export const supportedLocales: readonly string[] = launchLocales;
