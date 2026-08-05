import { describe, expect, it } from 'vitest';

import { allowanceSources, fortuneIntentions, orientations } from './index.js';

describe('shared domain values', () => {
  it('keeps the launch intention and allowance orders explicit', () => {
    expect(fortuneIntentions).toEqual(['GENERAL', 'LOVE', 'WORK', 'GROWTH']);
    expect(allowanceSources).toEqual(['FREE_DAILY', 'SUBSCRIPTION_DAILY', 'PACK_CREDIT']);
    expect(orientations).toEqual(['UPRIGHT', 'REVERSED']);
  });
});
