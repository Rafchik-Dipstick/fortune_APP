import { describe, expect, it } from 'vitest';

import { AccessTokenService } from '../auth/access-token.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import {
  DeletionManagementTokenError,
  DeletionManagementTokenService,
  deletionManagementTtlSeconds,
} from './deletion-management-token.js';

const environment = createTestApiEnvironment().authentication;
const userId = '3f1b0d5c-6c2f-4c86-9f6e-4f0f2a4a1d21';
const authenticatedAt = new Date('2026-08-07T01:00:00.000Z');
const now = new Date('2026-08-07T01:01:00.000Z');

const tokens = new DeletionManagementTokenService(environment, () => now);
const accessTokens = new AccessTokenService(environment, () => now);

describe('deletion-management tokens', () => {
  it('round-trips the user and the originating Apple sign-in time', async () => {
    const issued = await tokens.issue(userId, authenticatedAt);
    const claims = await tokens.verify(issued.token);

    expect(claims.userId).toBe(userId);
    expect(claims.authTime.toISOString()).toBe(authenticatedAt.toISOString());
    expect(issued.expiresAt.getTime()).toBe(now.getTime() + deletionManagementTtlSeconds * 1_000);
  });

  it('cannot be used as an access token', async () => {
    const issued = await tokens.issue(userId, authenticatedAt);

    // A different audience is what stops a deletion-scoped token from ever
    // satisfying an application route.
    await expect(accessTokens.verify(issued.token)).rejects.toThrow();
  });

  it('does not accept an ordinary access token', async () => {
    const access = await accessTokens.issue({
      authTime: authenticatedAt,
      sessionFamilyId: '9a3d0f52-1f28-4a9a-9a6c-8a6b53a5b0b7',
      sessionVersion: 1,
      userId,
    });

    await expect(tokens.verify(access.accessToken)).rejects.toBeInstanceOf(
      DeletionManagementTokenError,
    );
  });

  it('stops working once its fifteen minutes are up', async () => {
    const issued = await tokens.issue(userId, authenticatedAt);
    const later = new DeletionManagementTokenService(
      environment,
      () => new Date(issued.expiresAt.getTime() + 1_000),
    );

    await expect(later.verify(issued.token)).rejects.toBeInstanceOf(DeletionManagementTokenError);
  });

  it('rejects a tampered token', async () => {
    const issued = await tokens.issue(userId, authenticatedAt);
    const [header, payload, signature] = issued.token.split('.');
    const swapped = `${String(header)}.${String(payload)}.${String(signature).slice(0, -2)}xy`;

    await expect(tokens.verify(swapped)).rejects.toBeInstanceOf(DeletionManagementTokenError);
  });
});
