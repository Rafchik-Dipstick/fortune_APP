import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  apiPaths,
  healthResponseSchema,
  isoUtcDateTimeSchema,
  stableApiErrorCodes,
} from './index.js';

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

  it('rejects undocumented error codes and free-form details', () => {
    const baseError = {
      message: 'Request validation failed.',
      requestId: 'cce93010-158e-4d65-bdd8-38672203a59b',
      retryable: false,
      sameKeyRetrySafe: false,
    };

    expect(
      apiErrorEnvelopeSchema.safeParse({ error: { ...baseError, code: 'MADE_UP_ERROR' } }).success,
    ).toBe(false);
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: { ...baseError, code: 'VALIDATION_FAILED', details: { secret: true } },
      }).success,
    ).toBe(false);
  });

  it('owns the canonical Phase 3 path and response vocabulary', () => {
    expect(apiPaths).toEqual({ health: '/health' });
    expect(stableApiErrorCodes).toContain('RATE_LIMITED');
    expect(
      healthResponseSchema.safeParse({
        checks: { database: 'not_ready', process: 'ready' },
        status: 'not_ready',
      }).success,
    ).toBe(true);
  });
});
