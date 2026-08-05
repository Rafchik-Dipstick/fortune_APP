import { contentManifestSchema, scaffoldContentManifest } from './index.js';

contentManifestSchema.parse(scaffoldContentManifest);

process.stdout.write(
  'Fortune content scaffold is valid (0 cards; the Phase 2 gate requires 3 complete cards).\n',
);
