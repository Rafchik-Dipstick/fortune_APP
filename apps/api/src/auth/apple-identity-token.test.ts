import { errors, type JWTPayload, type JWTVerifyOptions } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { appleAuthRequestSchema, type AppleAuthRequest } from '@fortuneness/api-contracts';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { AppleIdentityVerificationError } from './apple-auth-errors.js';
import { AppleIdentityTokenVerifier } from './apple-identity-token.js';

const authenticationEnvironment = createTestApiEnvironment().authentication;
const now = new Date('2026-08-08T10:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1_000);

function request(overrides: Partial<AppleAuthRequest> = {}): AppleAuthRequest {
  return appleAuthRequestSchema.parse({
    identityToken: 'headerpayload.headerpayload.signaturepart',
    nonce: 'aabbccdd-1111-4222-8333-444455556666',
    reportedDeviceLocale: 'en-US',
    reportedDeviceTimeZone: 'Europe/Kyiv',
    device: { id: 'cce93010-158e-4d65-bdd8-38672203a59b' },
    ...overrides,
  });
}

function payload(overrides: Partial<JWTPayload> = {}): JWTPayload {
  return {
    aud: authenticationEnvironment.bundleId,
    exp: nowSeconds + 600,
    iat: nowSeconds - 1,
    iss: 'https://appleid.apple.com',
    nonce: request().nonce,
    sub: 'apple-subject-1',
    ...overrides,
  };
}

function verifier(result: JWTPayload | Error = payload()) {
  const verifyJwt = vi.fn((_token: string, _options: JWTVerifyOptions) =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve({ payload: result }),
  );
  return {
    instance: new AppleIdentityTokenVerifier(authenticationEnvironment, () => now, verifyJwt),
    verifyJwt,
  };
}

describe('AppleIdentityTokenVerifier', () => {
  it('returns only versioned subject digests and replay metadata', async () => {
    const { instance, verifyJwt } = verifier();
    const result = await instance.verify(request());

    expect(result.authenticatedAt).toEqual(new Date((nowSeconds - 1) * 1_000));
    expect(result.currentIdentity.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.identityCandidates).not.toHaveLength(0);
    expect(result.proofFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.proofExpiresAt).toEqual(new Date((nowSeconds + 600) * 1_000));
    expect(JSON.stringify(result)).not.toContain('apple-subject-1');
    expect(verifyJwt).toHaveBeenCalledWith(
      request().identityToken,
      expect.objectContaining({
        algorithms: ['RS256'],
        audience: authenticationEnvironment.bundleId,
        issuer: 'https://appleid.apple.com',
      }),
    );
  });

  it.each([
    [
      'missing subject',
      (() => {
        const claims = payload();
        delete claims.sub;
        return claims;
      })(),
    ],
    [
      'missing expiry',
      (() => {
        const claims = payload();
        delete claims.exp;
        return claims;
      })(),
    ],
    ['wrong nonce', payload({ nonce: 'another-nonce' })],
  ])('rejects %s', async (_label, claims) => {
    await expect(verifier(claims).instance.verify(request())).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('rejects stale and future authentication times', async () => {
    const stale = payload({
      iat: nowSeconds - authenticationEnvironment.appleIdentityTokenMaxAgeSeconds - 1,
    });
    const future = payload({
      iat: nowSeconds + authenticationEnvironment.appleIdentityTokenClockSkewSeconds + 1,
    });

    await expect(verifier(stale).instance.verify(request())).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    await expect(verifier(future).instance.verify(request())).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('maps token expiry, key availability, and invalid signatures to stable errors', async () => {
    await expect(
      verifier(new errors.JWTExpired('expired', {}, 'exp')).instance.verify(request()),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    await expect(
      verifier(new TypeError('network detail')).instance.verify(request()),
    ).rejects.toMatchObject({
      code: 'KEY_UNAVAILABLE',
      message: expect.not.stringContaining('network detail'),
    });
    await expect(
      verifier(new Error('bad signature')).instance.verify(request()),
    ).rejects.toBeInstanceOf(AppleIdentityVerificationError);
  });
});
