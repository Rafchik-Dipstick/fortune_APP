import {
  developmentContentManifest,
  developmentSliceExpectations,
  validateDevelopmentSlice,
} from './index.js';

const manifest = validateDevelopmentSlice(developmentContentManifest);
const readyForReviewTemplates = manifest.templates.filter(
  ({ editorialStatus }) => editorialStatus === 'READY_FOR_REVIEW',
).length;

process.stdout.write(
  [
    'Fortune content development slice is structurally valid.',
    `${String(manifest.cards.length)}/${String(developmentSliceExpectations.cards)} cards and illustration descriptions present.`,
    `${String(manifest.templates.length)}/${String(developmentSliceExpectations.templates)} English templates present.`,
    `${String(readyForReviewTemplates)} templates are ready for human editorial review; none are marked approved.`,
  ].join(' '),
);
process.stdout.write('\n');
