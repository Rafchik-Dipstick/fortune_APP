import { fullDeckCards } from '../../../tools/card-assets/full-deck-catalog.mjs';
import assetManifest from '../../../tools/card-assets/manifest.json' with { type: 'json' };

import {
  computeContentChecksum,
  createCanonicalDeck,
  crossCheckAssets,
  developmentContentManifest,
  developmentSliceExpectations,
  releaseGateExpectations,
  summarizeReleaseReadiness,
  validateDevelopmentSlice,
  validateReleaseManifest,
} from './index.js';

const releaseMode = process.argv.includes('--release');
const manifest = validateDevelopmentSlice(developmentContentManifest);
const canonicalDeck = createCanonicalDeck(fullDeckCards);
const assets = crossCheckAssets(canonicalDeck.cards, assetManifest);
const readiness = summarizeReleaseReadiness(manifest);

const referentialFailures = [
  assets.missingAssets.length === 0 ? '' : `missing card art: ${assets.missingAssets.join(', ')}`,
  assets.orphanedAssets.length === 0
    ? ''
    : `card art with no card: ${assets.orphanedAssets.join(', ')}`,
  assets.altTextMismatches.length === 0
    ? ''
    : `alternative text drift: ${assets.altTextMismatches.join(', ')}`,
  assets.uncheckedAssets.length === 0
    ? ''
    : `card art without a checksum: ${assets.uncheckedAssets.join(', ')}`,
].filter((failure) => failure.length > 0);

if (referentialFailures.length > 0) {
  process.stderr.write(`Content and card art disagree:\n- ${referentialFailures.join('\n- ')}\n`);
  process.exit(1);
}

const lines = [
  'Fortune content development slice is structurally valid.',
  `${String(manifest.cards.length)}/${String(developmentSliceExpectations.cards)} cards and illustration descriptions present.`,
  `${String(manifest.templates.length)}/${String(developmentSliceExpectations.templates)} English templates present.`,
  `${String(readiness.readyForReviewTemplates)} templates are ready for human editorial review; ${String(readiness.approvedTemplates)} are approved.`,
];

const releaseLines = [
  'Release gate progress:',
  `  cards active/approved: ${String(readiness.activeCards)}/${String(readiness.approvedCards)} of ${String(releaseGateExpectations.cards)}`,
  `  approved English combinations: ${String(readiness.satisfiedCombinations)} of ${String(readiness.requiredCombinations)}`,
  `  approved templates: ${String(readiness.approvedTemplates)} of ${String(releaseGateExpectations.minimumApprovedTemplates)} minimum (${String(releaseGateExpectations.targetTemplates)} target)`,
  `  card art checksummed/reviewed: ${String(canonicalDeck.cards.length - assets.uncheckedAssets.length)}/${String(canonicalDeck.cards.length - assets.unreviewedAssets.length)} of ${String(canonicalDeck.cards.length)}`,
  `  content checksum: ${computeContentChecksum(manifest)}`,
];

if (releaseMode) {
  validateReleaseManifest(manifest);
  if (assets.unreviewedAssets.length > 0) {
    throw new Error(
      `The release gate requires reviewed card art; ${String(assets.unreviewedAssets.length)} illustrations are unreviewed.`,
    );
  }
  process.stdout.write(`${[...lines, ...releaseLines, 'Release gate satisfied.'].join('\n')}\n`);
} else {
  process.stdout.write(`${[lines.join(' '), ...releaseLines].join('\n')}\n`);
}
