import { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  apiPaths,
  type AppleAuthRequest,
  type AppleAuthResponse,
  type MeResponse,
  type RefreshSessionRequest,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { AccountBootstrapError } from '../auth/account-bootstrap.js';
import { AppleIdentityVerificationError } from '../auth/apple-auth-errors.js';
import { AppleLoginError } from '../auth/apple-login.js';
import { LogoutSessionError } from '../auth/logout-session.js';
import { RefreshSessionError } from '../auth/refresh-session.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';
import {
  type AppleLoginHandler,
  type AccountBootstrapHandler,
  type LogoutSessionHandler,
  type RefreshSessionHandler,
  registerAuthenticationRoutes,
} from './authentication.js';

const body: AppleAuthRequest = {
  identityToken: 'headerpayload.headerpayload.signaturepart',
  nonce: '77777777-7777-4777-8777-777777777777',
  reportedDeviceLocale: 'en-US',
  reportedDeviceTimeZone: 'Europe/Kyiv',
  device: { id: '11111111-1111-4111-8111-111111111111', description: 'iPhone' },
};

const result: AppleAuthResponse = {
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

const createLoginMock = () => vi.fn<AppleLoginHandler['login']>();
const createRefreshMock = () => vi.fn<RefreshSessionHandler['refresh']>();
const createLogoutMock = () => vi.fn<LogoutSessionHandler['logout']>();
const createBootstrapMock = () => vi.fn<AccountBootstrapHandler['get']>();
const authentication = {
  userId: '22222222-2222-4222-8222-222222222222',
  sessionFamilyId: '66666666-6666-4666-8666-666666666666',
  sessionVersion: 3,
  authTimeSeconds: 1_786_000_000,
  authTime: new Date('2026-08-06T10:00:00.000Z'),
};
const authenticate: RequestHandler = (authenticatedRequest, _response, next) => {
  authenticatedRequest.authentication = authentication;
  next();
};

function createFixture(
  login: AppleLoginHandler['login'] = createLoginMock(),
  refresh: RefreshSessionHandler['refresh'] = createRefreshMock(),
  logout: LogoutSessionHandler['logout'] = createLogoutMock(),
  bootstrap: AccountBootstrapHandler['get'] = createBootstrapMock(),
) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (app) => {
      registerAuthenticationRoutes(app, {
        authenticate,
        bootstrap: { get: bootstrap },
        login: { login },
        logout: { logout },
        refresh: { refresh },
      });
    },
  });
}

describe('Apple authentication route', () => {
  it('validates, delegates, and returns a non-cacheable bootstrap', async () => {
    const login = createLoginMock().mockResolvedValue(result);
    const response = await request(createFixture(login))
      .post(apiPaths.authApple)
      .send(body)
      .expect(200);

    expect(response.body).toEqual(result);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(login).toHaveBeenCalledWith(body);
  });

  it('rejects malformed input before the service', async () => {
    const login = createLoginMock();
    const response = await request(createFixture(login))
      .post(apiPaths.authApple)
      .send({ ...body, identityToken: 'not-a-token' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    [new AppleIdentityVerificationError('TOKEN_EXPIRED'), 401, 'APPLE_ID_TOKEN_EXPIRED'],
    [new AppleIdentityVerificationError('INVALID_TOKEN'), 401, 'APPLE_ID_TOKEN_INVALID'],
    [new AppleIdentityVerificationError('KEY_UNAVAILABLE'), 503, 'APPLE_ID_UNAVAILABLE'],
    [new AppleLoginError('PROOF_REPLAY'), 401, 'APPLE_ID_TOKEN_INVALID'],
    [new AppleLoginError('TIME_ZONE_INVALID'), 400, 'VALIDATION_FAILED'],
    [new AppleLoginError('ACCOUNT_DELETION_PENDING'), 423, 'ACCOUNT_DELETION_PENDING'],
    [new AppleLoginError('ACCOUNT_PURGED'), 410, 'ACCOUNT_PURGED'],
  ] as const)('maps safe authentication failures', async (failure, status, code) => {
    const response = await request(createFixture(createLoginMock().mockRejectedValue(failure)))
      .post(apiPaths.authApple)
      .send(body)
      .expect(status);

    expect(response.body.error.code).toBe(code);
    expect(response.body.error).not.toHaveProperty('details');
  });
});

describe('refresh authentication route', () => {
  const refreshBody: RefreshSessionRequest = {
    refreshToken: 'r'.repeat(43),
    device: { id: '44444444-4444-4444-8444-444444444444', description: 'iPad' },
  };
  const refreshResult: RefreshSessionResponse = { session: result.session };
  const idempotencyKey = '55555555-5555-4555-8555-555555555555';

  it('requires a UUID key, echoes it, and returns a non-cacheable replacement', async () => {
    const refresh = createRefreshMock().mockResolvedValue(refreshResult);
    const response = await request(createFixture(undefined, refresh))
      .post(apiPaths.authRefresh)
      .set('Idempotency-Key', idempotencyKey)
      .send(refreshBody)
      .expect(200);

    expect(response.body).toEqual(refreshResult);
    expect(response.headers['idempotency-key']).toBe(idempotencyKey);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(refresh).toHaveBeenCalledWith(refreshBody, idempotencyKey);
  });

  it('rejects missing keys before token lookup', async () => {
    const refresh = createRefreshMock();
    const response = await request(createFixture(undefined, refresh))
      .post(apiPaths.authRefresh)
      .send(refreshBody)
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    [new RefreshSessionError('AUTH_REQUIRED'), 401, 'AUTH_REQUIRED'],
    [new RefreshSessionError('IDEMPOTENCY_KEY_REUSED'), 409, 'IDEMPOTENCY_KEY_REUSED'],
    [new RefreshSessionError('ACCOUNT_DELETION_PENDING'), 423, 'ACCOUNT_DELETION_PENDING'],
    [new RefreshSessionError('ACCOUNT_PURGED'), 410, 'ACCOUNT_PURGED'],
  ] as const)('maps safe refresh failures', async (failure, status, code) => {
    const response = await request(
      createFixture(undefined, createRefreshMock().mockRejectedValue(failure)),
    )
      .post(apiPaths.authRefresh)
      .set('Idempotency-Key', idempotencyKey)
      .send(refreshBody)
      .expect(status);

    expect(response.body.error.code).toBe(code);
  });
});

describe('logout route', () => {
  it('revokes the authoritative family and returns no body', async () => {
    const logout = createLogoutMock().mockResolvedValue(undefined);
    const response = await request(createFixture(undefined, undefined, logout))
      .post(apiPaths.authLogout)
      .expect(204);

    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(logout).toHaveBeenCalledWith(authentication);
  });

  it.each([
    [new LogoutSessionError('AUTH_REQUIRED'), 401, 'AUTH_REQUIRED'],
    [new LogoutSessionError('ACCOUNT_DELETION_PENDING'), 423, 'ACCOUNT_DELETION_PENDING'],
    [new LogoutSessionError('ACCOUNT_PURGED'), 410, 'ACCOUNT_PURGED'],
  ] as const)('maps safe logout failures', async (failure, status, code) => {
    const response = await request(
      createFixture(undefined, undefined, createLogoutMock().mockRejectedValue(failure)),
    )
      .post(apiPaths.authLogout)
      .expect(status);

    expect(response.body.error.code).toBe(code);
  });
});

describe('account bootstrap route', () => {
  const meResult: MeResponse = { user: result.user, bootstrap: result.bootstrap };

  it('returns the current account and purchase token without caching', async () => {
    const bootstrap = createBootstrapMock().mockResolvedValue(meResult);
    const response = await request(createFixture(undefined, undefined, undefined, bootstrap))
      .get(apiPaths.me)
      .expect(200);

    expect(response.body).toEqual(meResult);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(bootstrap).toHaveBeenCalledWith(authentication);
  });

  it.each([
    [new AccountBootstrapError('AUTH_REQUIRED'), 401, 'AUTH_REQUIRED'],
    [new AccountBootstrapError('ACCOUNT_DELETION_PENDING'), 423, 'ACCOUNT_DELETION_PENDING'],
    [new AccountBootstrapError('ACCOUNT_PURGED'), 410, 'ACCOUNT_PURGED'],
  ] as const)('maps safe bootstrap failures', async (failure, status, code) => {
    const response = await request(
      createFixture(
        undefined,
        undefined,
        undefined,
        createBootstrapMock().mockRejectedValue(failure),
      ),
    )
      .get(apiPaths.me)
      .expect(status);

    expect(response.body.error.code).toBe(code);
  });
});
