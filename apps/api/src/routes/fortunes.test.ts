import { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { apiPaths, type FortuneStateResponse } from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { FortuneStateError } from '../fortune/state.js';
import { ApiReadiness } from '../health/readiness.js';
import { type FortuneStateHandler, registerFortuneRoutes } from './fortunes.js';

const authentication = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionFamilyId: '22222222-2222-4222-8222-222222222222',
  sessionVersion: 1,
  authTimeSeconds: 1_786_000_000,
  authTime: new Date('2026-08-06T10:00:00.000Z'),
};

const stateResponse: FortuneStateResponse = {
  state: {
    serverTime: '2026-08-06T10:00:00.000Z',
    freeRemaining: 1,
    subscriptionRemaining: 0,
    spendablePackCredits: 0,
    availableDraws: 1,
    allowancePeriodId: '33333333-3333-4333-8333-333333333333',
    currentPeriodStartedAt: '2026-08-05T21:00:00.000Z',
    nextResetAt: '2026-08-06T21:00:00.000Z',
    accountTimeZone: 'Europe/Kyiv',
    reportedDeviceTimeZone: 'America/Los_Angeles',
    pendingTimeZone: null,
    timeZoneEffectiveAt: null,
    nextTimeZoneChangeEligibleAt: null,
    subscription: {
      status: 'NONE',
      entitled: false,
      paidThrough: null,
      graceThrough: null,
    },
  },
  unviewedDraw: null,
};

const authenticate: RequestHandler = (request, _response, next) => {
  request.authentication = authentication;
  next();
};

function createFixture(get: FortuneStateHandler['get']) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (app) => {
      registerFortuneRoutes(app, { authenticate, state: { get } });
    },
  });
}

describe('fortune state route', () => {
  it('returns validated non-cacheable authoritative state', async () => {
    const get = vi.fn<FortuneStateHandler['get']>().mockResolvedValue(stateResponse);
    const response = await request(createFixture(get)).get(apiPaths.fortuneState).expect(200);

    expect(response.body).toEqual(stateResponse);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(get).toHaveBeenCalledWith(authentication);
  });

  it.each([
    ['AUTH_REQUIRED', 401, 'AUTH_REQUIRED'],
    ['ACCOUNT_DELETION_PENDING', 423, 'ACCOUNT_DELETION_PENDING'],
    ['ACCOUNT_PURGED', 410, 'ACCOUNT_PURGED'],
  ] as const)('maps %s without leaking internal state', async (serviceCode, status, apiCode) => {
    const get = vi
      .fn<FortuneStateHandler['get']>()
      .mockRejectedValue(new FortuneStateError(serviceCode));
    const response = await request(createFixture(get)).get(apiPaths.fortuneState).expect(status);

    expect(response.body.error.code).toBe(apiCode);
    expect(response.body).not.toHaveProperty('state');
  });
});
