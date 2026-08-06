import { describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { AccessTokenError, AccessTokenService } from './access-token.js';

const now = new Date('2026-08-06T10:00:00.999Z');
const options = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionFamilyId: '22222222-2222-4222-8222-222222222222',
  sessionVersion: 3,
  authTime: new Date('2026-08-06T09:59:30.456Z'),
};

describe('AccessTokenService', () => {
  it('issues and verifies bounded authoritative session claims', async () => {
    const environment = createTestApiEnvironment().authentication;
    const service = new AccessTokenService(environment, () => now);
    const issued = await service.issue(options);
    const verified = await service.verify(issued.accessToken);

    expect(verified).toEqual({
      userId: options.userId,
      sessionFamilyId: options.sessionFamilyId,
      sessionVersion: options.sessionVersion,
      authTimeSeconds: Math.floor(options.authTime.getTime() / 1_000),
      issuedAt: new Date('2026-08-06T10:00:00.000Z'),
      expiresAt: new Date('2026-08-06T10:15:00.000Z'),
    });
    expect(issued.expiresAt).toEqual(verified.expiresAt);
  });

  it('verifies a previous kid while retained and rejects it after removal', async () => {
    const base = createTestApiEnvironment().authentication;
    const oldEnvironment = {
      ...base,
      jwtAccessKeys: {
        currentVersion: 'v0',
        keys: { ...base.jwtAccessKeys.keys, v0: Buffer.alloc(32, 6) },
      },
    };
    const token = await new AccessTokenService(oldEnvironment, () => now).issue(options);
    const rotatedEnvironment = {
      ...base,
      jwtAccessKeys: {
        currentVersion: base.jwtAccessKeys.currentVersion,
        keys: { ...oldEnvironment.jwtAccessKeys.keys },
      },
    };

    await expect(
      new AccessTokenService(rotatedEnvironment, () => now).verify(token.accessToken),
    ).resolves.toMatchObject({ userId: options.userId });
    await expect(
      new AccessTokenService(base, () => now).verify(token.accessToken),
    ).rejects.toBeInstanceOf(AccessTokenError);
  });

  it('rejects expiration, tampering, and the wrong audience', async () => {
    const environment = createTestApiEnvironment().authentication;
    const issued = await new AccessTokenService(environment, () => now).issue(options);

    await expect(
      new AccessTokenService(environment, () => new Date('2026-08-06T10:16:00.000Z')).verify(
        issued.accessToken,
      ),
    ).rejects.toBeInstanceOf(AccessTokenError);
    await expect(
      new AccessTokenService(environment, () => now).verify(`${issued.accessToken}x`),
    ).rejects.toBeInstanceOf(AccessTokenError);
    await expect(
      new AccessTokenService({ ...environment, jwtAudience: 'another-app' }, () => now).verify(
        issued.accessToken,
      ),
    ).rejects.toBeInstanceOf(AccessTokenError);
  });
});
