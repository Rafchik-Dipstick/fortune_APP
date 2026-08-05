import { describe, expect, it } from 'vitest';

import { contentManifestSchema, scaffoldContentManifest } from './index.js';

describe('content manifest scaffold', () => {
  it('accepts the explicit empty Phase 1 manifest', () => {
    expect(contentManifestSchema.parse(scaffoldContentManifest)).toBeDefined();
  });

  it('rejects duplicate card keys', () => {
    const result = contentManifestSchema.safeParse({
      ...scaffoldContentManifest,
      cards: [{ key: 'major-00-fool' }, { key: 'major-00-fool' }],
    });

    expect(result.success).toBe(false);
  });
});
