import { describe, expect, it } from 'vitest';

import { apiErrorEnvelopeSchema, isoUtcDateTimeSchema } from './index.js';

describe('base API contracts', () => {
  it('accepts the normalized error envelope', () => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
          requestId: 'cce93010-158e-4d65-bdd8-38672203a59b',
          retryable: false,
          sameKeyRetrySafe: false,
        },
      }),
    ).toBeDefined();
  });

  it('requires an offset in API timestamps', () => {
    expect(isoUtcDateTimeSchema.safeParse('2026-08-05T14:30:00.000Z').success).toBe(true);
    expect(isoUtcDateTimeSchema.safeParse('2026-08-05T14:30:00.000').success).toBe(false);
  });
});
