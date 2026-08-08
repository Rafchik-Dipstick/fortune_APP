import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApiApp } from '../app.js';
import { AccessTokenService } from '../auth/access-token.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { ApiReadiness } from '../health/readiness.js';
import { createAuthoritativeAuthentication } from './authentication.js';

const environment = createTestApiEnvironment({ logLevel: 'silent' });
const now = new Date('2026-08-06T10:00:00.000Z');
const userId = '11111111-1111-4111-8111-111111111111';
const sessionFamilyId = '22222222-2222-4222-8222-222222222222';

async function createFixture(overrides: Record<string, unknown> = {}) {
  const accessTokens = new AccessTokenService(environment.authentication, () => now);
  const issued = await accessTokens.issue({
    userId,
    sessionFamilyId,
    sessionVersion: 3,
    authTime: new Date('2026-08-06T09:59:30.000Z'),
  });
  const findUnique = vi.fn().mockResolvedValue({
    id: sessionFamilyId,
    userId,
    sessionVersion: 3,
    revokedAt: null,
    expiresAt: new Date('2026-09-05T10:00:00.000Z'),
    identityAuthenticatedAt: new Date('2026-08-06T09:59:30.999Z'),
    user: { id: userId, status: 'ACTIVE', sessionVersion: 3 },
    ...overrides,
  });
  const client = { sessionFamily: { findUnique } } as unknown as PrismaClient;
  const app = createApiApp({
    environment,
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (configuredApp) => {
      configuredApp.get(
        '/protected',
        createAuthoritativeAuthentication(client, accessTokens, () => now),
        (authenticatedRequest, response) => {
          response.status(200).json({ userId: authenticatedRequest.authentication.userId });
        },
      );
    },
  });
  return { app, findUnique, token: issued.accessToken };
}

describe('authoritative access authentication', () => {
  it('authorizes only after the current family and user state match', async () => {
    const fixture = await createFixture();
    const response = await request(fixture.app)
      .get('/protected')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(200);

    expect(response.body).toEqual({ userId });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(fixture.findUnique).toHaveBeenCalledOnce();
  });

  it.each([
    [{ revokedAt: new Date('2026-08-06T09:59:59.000Z') }, 401, 'AUTH_REQUIRED'],
    [{ expiresAt: new Date('2026-08-06T09:59:59.000Z') }, 401, 'AUTH_REQUIRED'],
    [{ sessionVersion: 2 }, 401, 'AUTH_REQUIRED'],
    [{ user: { id: userId, status: 'ACTIVE', sessionVersion: 4 } }, 401, 'AUTH_REQUIRED'],
    [
      { user: { id: userId, status: 'DELETION_PENDING', sessionVersion: 3 } },
      423,
      'ACCOUNT_DELETION_PENDING',
    ],
    [{ user: { id: userId, status: 'PURGED', sessionVersion: 3 } }, 410, 'ACCOUNT_PURGED'],
  ] as const)('invalidates stale authoritative state', async (overrides, status, code) => {
    const fixture = await createFixture(overrides);
    const response = await request(fixture.app)
      .get('/protected')
      .set('Authorization', `Bearer ${fixture.token}`)
      .expect(status);

    expect(response.body.error.code).toBe(code);
  });

  it('rejects missing and tampered bearer tokens before database lookup', async () => {
    const fixture = await createFixture();
    await request(fixture.app).get('/protected').expect(401);
    await request(fixture.app)
      .get('/protected')
      .set('Authorization', `Bearer ${fixture.token}x`)
      .expect(401);

    expect(fixture.findUnique).not.toHaveBeenCalled();
  });
});
