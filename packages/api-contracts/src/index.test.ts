import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  apiPaths,
  gameCenterAuthRequestSchema,
  gameCenterAuthResponseSchema,
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

  it('validates exact Game Center proof and bootstrap boundaries', () => {
    const request = {
      proof: {
        teamPlayerId: 'team-player',
        gamePlayerId: 'game-player',
        bundleId: 'app.fortuneness.dev',
        publicKeyUrl: 'https://static.gc.apple.com/public-key.cer',
        signatureBase64: 'c2lnbmF0dXJl',
        saltBase64: 'c2FsdA==',
        timestamp: '1786009600000',
      },
      scopedIdsPersistent: true,
      alias: 'Stargazer',
      restrictions: {
        isUnderage: false,
        isMultiplayerGamingRestricted: false,
        isPersonalizedCommunicationRestricted: false,
      },
      reportedDeviceLocale: 'en-US',
      reportedDeviceTimeZone: 'Europe/Kyiv',
      device: { id: 'cce93010-158e-4d65-bdd8-38672203a59b', description: 'iPhone' },
    };

    expect(gameCenterAuthRequestSchema.parse(request)).toEqual(request);
    expect(
      gameCenterAuthRequestSchema.safeParse({
        ...request,
        scopedIdsPersistent: false,
      }).success,
    ).toBe(true);
    expect(
      gameCenterAuthRequestSchema.safeParse({
        ...request,
        proof: { ...request.proof, publicKeyUrl: 'http://127.0.0.1/key' },
      }).success,
    ).toBe(false);

    expect(
      gameCenterAuthResponseSchema.safeParse({
        user: {},
        session: {},
        bootstrap: {},
      }).success,
    ).toBe(false);
  });
});
