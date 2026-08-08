import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  apiPaths,
  appleAuthRequestSchema,
  appleAuthResponseSchema,
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
    expect(apiPaths.health).toBe('/health');
    expect(stableApiErrorCodes).toContain('RATE_LIMITED');
    expect(
      healthResponseSchema.safeParse({
        checks: { database: 'not_ready', process: 'ready' },
        status: 'not_ready',
      }).success,
    ).toBe(true);
  });

  it('validates exact Apple identity-token and bootstrap boundaries', () => {
    const request = {
      identityToken: 'headerpayload.headerpayload.signaturepart',
      nonce: 'aabbccdd-1111-4222-8333-444455556666',
      reportedDeviceLocale: 'en-US',
      reportedDeviceTimeZone: 'Europe/Kyiv',
      device: { id: 'cce93010-158e-4d65-bdd8-38672203a59b', description: 'iPhone' },
    };

    expect(appleAuthRequestSchema.parse(request)).toEqual(request);
    expect(
      appleAuthRequestSchema.safeParse({
        ...request,
        identityToken: 'not-a-jwt',
      }).success,
    ).toBe(false);

    expect(
      appleAuthResponseSchema.safeParse({
        user: {},
        session: {},
        bootstrap: {},
      }).success,
    ).toBe(false);
  });
});
