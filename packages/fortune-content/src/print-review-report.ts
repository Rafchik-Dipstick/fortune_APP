import { developmentContentManifest, validateDevelopmentSlice } from './index.js';
import { renderEditorialReviewMarkdown } from './review-report.js';

const manifest = validateDevelopmentSlice(developmentContentManifest);
process.stdout.write(renderEditorialReviewMarkdown(manifest));
