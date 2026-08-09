import { type JWTPayload, type JWTVerifyOptions } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import {
  AppleIdentityNotificationError,
  AppleIdentityNotificationTokenVerifier,
} from './apple-identity-notification.js';

const environment = createTestApiEnvironment().authentication;
const now = new Date('2026-08-09T12:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1_000);

function payload(overrides: Partial<JWTPayload> = {}): JWTPayload {
  return {
    aud: environment.bundleId,
    iat: nowSeconds - 2,
    iss: 'https://appleid.apple.com',
    jti: 'apple-notification-1',
    events: {
      event_time: nowSeconds - 3,
      sub: 'apple-subject-1',
      type: 'consent-revoked',
    },
    ...overrides,
  };
}

function verifier(result: JWTPayload | Error = payload()) {
  const verifyJwt = vi.fn((_token: string, _options: JWTVerifyOptions) =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve({ payload: result }),
  );
  return {
    instance: new AppleIdentityNotificationTokenVerifier(environment, () => now, verifyJwt),
    verifyJwt,
  };
}

describe('AppleIdentityNotificationTokenVerifier', () => {
  it('verifies Apple constraints and exposes only digests and bounded event metadata', async () => {
    const { instance, verifyJwt } = verifier();
    const result = await instance.verify('headerpayload.headerpayload.signaturepart');

    expect(result).toMatchObject({
      eventAt: new Date((nowSeconds - 3) * 1_000),
      type: 'consent-revoked',
    });
    expect(result.notificationId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(result.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.identityCandidates[0]?.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('apple-subject-1');
    expect(verifyJwt).toHaveBeenCalledWith(
      'headerpayload.headerpayload.signaturepart',
      expect.objectContaining({
        algorithms: ['RS256'],
        audience: environment.bundleId,
        issuer: 'https://appleid.apple.com',
      }),
    );
  });

  it.each([
    ['missing events', payload({ events: undefined })],
    [
      'missing jti',
      (() => {
        const claims = payload();
        delete claims.jti;
        return claims;
      })(),
    ],
    [
      'future event',
      payload({
        events: {
          event_time: nowSeconds + environment.appleIdentityTokenClockSkewSeconds + 1,
          sub: 'apple-subject-1',
          type: 'account-deleted',
        },
      }),
    ],
  ])('rejects %s', async (_label, claims) => {
    await expect(
      verifier(claims).instance.verify('headerpayload.headerpayload.signaturepart'),
    ).rejects.toMatchObject({ code: 'INVALID_NOTIFICATION' });
  });

  it('distinguishes key availability from a bad signature', async () => {
    await expect(
      verifier(new TypeError('network detail')).instance.verify(
        'headerpayload.headerpayload.signaturepart',
      ),
    ).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    await expect(
      verifier(new Error('bad signature')).instance.verify(
        'headerpayload.headerpayload.signaturepart',
      ),
    ).rejects.toBeInstanceOf(AppleIdentityNotificationError);
  });
});
