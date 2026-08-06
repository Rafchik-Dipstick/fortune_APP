import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  apiPaths,
  type GameCenterAuthRequest,
  type GameCenterAuthResponse,
} from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { GameCenterVerificationError } from '../auth/game-center-errors.js';
import { GameCenterLoginError } from '../auth/game-center-login.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';
import { type GameCenterLoginHandler, registerAuthenticationRoutes } from './authentication.js';

const body: GameCenterAuthRequest = {
  proof: {
    teamPlayerId: 'team-player-id',
    gamePlayerId: 'game-player-id',
    bundleId: 'app.fortuneness.test',
    publicKeyUrl: 'https://static.gc.apple.com/public-key.cer',
    signatureBase64: Buffer.from('signature').toString('base64'),
    saltBase64: Buffer.from('salt').toString('base64'),
    timestamp: '1786000000000',
  },
  scopedIdsPersistent: true,
  alias: 'Player',
  restrictions: {
    isUnderage: false,
    isMultiplayerGamingRestricted: false,
    isPersonalizedCommunicationRestricted: false,
  },
  reportedDeviceLocale: 'en-US',
  reportedDeviceTimeZone: 'Europe/Kyiv',
  device: { id: '11111111-1111-4111-8111-111111111111', description: 'iPhone' },
};

const result: GameCenterAuthResponse = {
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'ACTIVE',
    resolvedLocale: 'en',
    accountTimeZone: 'Europe/Kyiv',
    pendingTimeZone: null,
    timeZoneEffectiveAt: null,
    nextTimeZoneChangeEligibleAt: null,
    onboardingCompletedAt: null,
    preferences: {
      reminderEnabled: false,
      reminderLocalMinutes: 540,
      soundEnabled: true,
      hapticsEnabled: true,
      reduceMotionPreferred: false,
    },
  },
  session: {
    accessToken: 'a'.repeat(64),
    refreshToken: 'b'.repeat(43),
    accessTokenExpiresAt: '2026-08-06T10:15:00.000Z',
    refreshTokenExpiresAt: '2026-09-05T10:00:00.000Z',
    authTime: '2026-08-06T10:00:00.000Z',
  },
  bootstrap: {
    serverTime: '2026-08-06T10:00:00.000Z',
    reportedDeviceLocale: 'en-US',
    reportedDeviceTimeZone: 'Europe/Kyiv',
    appAccountToken: '33333333-3333-4333-8333-333333333333',
  },
};

const createLoginMock = () => vi.fn<GameCenterLoginHandler['login']>();

function createFixture(login: GameCenterLoginHandler['login']) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (app) => {
      registerAuthenticationRoutes(app, { login });
    },
  });
}

describe('Game Center authentication route', () => {
  it('validates, delegates, and returns a non-cacheable bootstrap', async () => {
    const login = createLoginMock().mockResolvedValue(result);
    const response = await request(createFixture(login))
      .post(apiPaths.authGameCenter)
      .send(body)
      .expect(200);

    expect(response.body).toEqual(result);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(login).toHaveBeenCalledWith(body);
  });

  it('rejects malformed input before the service', async () => {
    const login = createLoginMock();
    const response = await request(createFixture(login))
      .post(apiPaths.authGameCenter)
      .send({ ...body, proof: { ...body.proof, timestamp: 1 } })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    [new GameCenterVerificationError('NONPERSISTENT_ID'), 409, 'GAME_CENTER_ID_NOT_PERSISTENT'],
    [new GameCenterVerificationError('PROOF_EXPIRED'), 401, 'GAME_CENTER_PROOF_EXPIRED'],
    [new GameCenterVerificationError('INVALID_PROOF'), 401, 'GAME_CENTER_PROOF_INVALID'],
    [new GameCenterVerificationError('KEY_UNAVAILABLE'), 503, 'GAME_CENTER_UNAVAILABLE'],
    [new GameCenterLoginError('PROOF_REPLAY'), 401, 'GAME_CENTER_PROOF_INVALID'],
    [new GameCenterLoginError('TIME_ZONE_INVALID'), 400, 'VALIDATION_FAILED'],
    [new GameCenterLoginError('ACCOUNT_DELETION_PENDING'), 423, 'ACCOUNT_DELETION_PENDING'],
    [new GameCenterLoginError('ACCOUNT_PURGED'), 410, 'ACCOUNT_PURGED'],
  ] as const)('maps safe authentication failures', async (failure, status, code) => {
    const response = await request(createFixture(createLoginMock().mockRejectedValue(failure)))
      .post(apiPaths.authGameCenter)
      .send(body)
      .expect(status);

    expect(response.body.error.code).toBe(code);
    expect(response.body.error).not.toHaveProperty('details');
  });
});
