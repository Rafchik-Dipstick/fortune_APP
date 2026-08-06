import { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  apiPaths,
  type FortuneDrawResponse,
  type FortuneStateResponse,
} from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { FortuneDrawError } from '../fortune/draw.js';
import { FortuneStateError } from '../fortune/state.js';
import { ApiReadiness } from '../health/readiness.js';
import type { FortuneDrawTelemetry } from '../observability/fortune-draw-telemetry.js';
import {
  type FortuneDrawHandler,
  type FortuneStateHandler,
  type FortuneViewedHandler,
  registerFortuneRoutes,
} from './fortunes.js';

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

const drawResponse: FortuneDrawResponse = {
  state: { ...stateResponse.state, freeRemaining: 0, availableDraws: 0 },
  draw: {
    id: '44444444-4444-4444-8444-444444444444',
    cardKey: 'major-00-fool',
    cardDisplayNumber: '0',
    cardName: 'The Fool',
    orientation: 'UPRIGHT',
    intention: 'GROWTH',
    resolvedLocale: 'en',
    artAltText: 'A traveler steps toward dawn beneath a wandering star.',
    headline: 'Begin before certainty arrives',
    message: 'A gentle opening asks for curiosity rather than certainty.',
    action: 'Give one small beginning ten honest minutes.',
    affirmation: 'I can meet the unknown with curiosity.',
    allowanceSource: 'FREE_DAILY',
    contentVersion: 'development-v1',
    issuedAt: '2026-08-06T10:00:00.000Z',
    viewedAt: null,
  },
};

const authenticate: RequestHandler = (request, _response, next) => {
  request.authentication = authentication;
  next();
};

function createFixture(
  get: FortuneStateHandler['get'] = vi.fn(),
  draw: FortuneDrawHandler['draw'] = vi.fn(),
  markViewed: FortuneViewedHandler['markViewed'] = vi.fn(),
  telemetry?: FortuneDrawTelemetry,
) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (app) => {
      registerFortuneRoutes(app, {
        authenticate,
        draw: { draw },
        state: { get },
        ...(telemetry === undefined ? {} : { telemetry }),
        viewed: { markViewed },
      });
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

describe('fortune draw route', () => {
  const idempotencyKey = '55555555-5555-4555-8555-555555555555';

  it.each([
    [true, 201],
    [false, 200],
  ] as const)('returns the validated keyed result when created=%s', async (created, status) => {
    const draw = vi
      .fn<FortuneDrawHandler['draw']>()
      .mockResolvedValue({ created, response: drawResponse });
    const response = await request(createFixture(undefined, draw))
      .post(apiPaths.fortuneDraw)
      .set('Idempotency-Key', idempotencyKey)
      .send({ intention: 'GROWTH' })
      .expect(status);

    expect(response.body).toEqual(drawResponse);
    expect(response.headers['idempotency-key']).toBe(idempotencyKey);
    expect(draw).toHaveBeenCalledWith(authentication, { intention: 'GROWTH' }, idempotencyKey);
  });

  it('rejects client-owned selection input before delegation', async () => {
    const draw = vi.fn<FortuneDrawHandler['draw']>();
    const response = await request(createFixture(undefined, draw))
      .post(apiPaths.fortuneDraw)
      .set('Idempotency-Key', idempotencyKey)
      .send({ intention: 'GROWTH', cardKey: 'major-00-fool' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(draw).not.toHaveBeenCalled();
  });

  it('records only allowlisted issued metadata without fortune or account content', async () => {
    const recordIssued = vi.fn();
    const recordRejected = vi.fn();
    const telemetry = { recordIssued, recordRejected };
    const draw = vi
      .fn<FortuneDrawHandler['draw']>()
      .mockResolvedValue({ created: true, response: drawResponse });

    await request(createFixture(undefined, draw, undefined, telemetry))
      .post(apiPaths.fortuneDraw)
      .set('Idempotency-Key', idempotencyKey)
      .send({ intention: 'GROWTH' })
      .expect(201);

    expect(recordIssued).toHaveBeenCalledWith({
      allowanceSource: 'FREE_DAILY',
      intention: 'GROWTH',
    });
    expect(recordRejected).not.toHaveBeenCalled();
    const serializedEvent = JSON.stringify(recordIssued.mock.calls);
    expect(serializedEvent).not.toContain(drawResponse.draw.id);
    expect(serializedEvent).not.toContain(drawResponse.draw.cardName);
    expect(serializedEvent).not.toContain(drawResponse.draw.headline);
    expect(serializedEvent).not.toContain(authentication.userId);
  });

  it('returns stored terminal state in code-specific details', async () => {
    const recordRejected = vi.fn();
    const draw = vi.fn<FortuneDrawHandler['draw']>().mockRejectedValue(
      new FortuneDrawError('UNVIEWED_READING_PENDING', {
        state: drawResponse.state,
        unviewedDraw: drawResponse.draw,
      }),
    );
    const response = await request(
      createFixture(undefined, draw, undefined, {
        recordIssued: vi.fn(),
        recordRejected,
      }),
    )
      .post(apiPaths.fortuneDraw)
      .set('Idempotency-Key', idempotencyKey)
      .send({ intention: 'GROWTH' })
      .expect(409);

    expect(response.body.error).toMatchObject({
      code: 'UNVIEWED_READING_PENDING',
      sameKeyRetrySafe: true,
      details: { state: drawResponse.state, unviewedDraw: drawResponse.draw },
    });
    expect(recordRejected).toHaveBeenCalledWith('UNVIEWED_READING_PENDING');
  });
});

describe('fortune viewed route', () => {
  it('acknowledges one owned reading idempotently through the handler', async () => {
    const markViewed = vi.fn<FortuneViewedHandler['markViewed']>().mockResolvedValue({
      draw: { ...drawResponse.draw, viewedAt: '2026-08-06T10:01:00.000Z' },
    });
    const response = await request(createFixture(undefined, undefined, markViewed))
      .patch(`/v1/fortunes/${drawResponse.draw.id}/viewed`)
      .expect(200);

    expect(response.body.draw.viewedAt).toBe('2026-08-06T10:01:00.000Z');
    expect(markViewed).toHaveBeenCalledWith(authentication, drawResponse.draw.id);
  });

  it('rejects malformed identifiers before delegation', async () => {
    const markViewed = vi.fn<FortuneViewedHandler['markViewed']>();
    const response = await request(createFixture(undefined, undefined, markViewed))
      .patch('/v1/fortunes/not-a-uuid/viewed')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(markViewed).not.toHaveBeenCalled();
  });
});
