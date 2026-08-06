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
import { FortuneArchiveError } from '../fortune/archive.js';
import { FortuneDrawError } from '../fortune/draw.js';
import { FortuneStateError } from '../fortune/state.js';
import { ApiReadiness } from '../health/readiness.js';
import type { FortuneDrawTelemetry } from '../observability/fortune-draw-telemetry.js';
import {
  type FortuneArchiveHandler,
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
  handlers: {
    draw?: FortuneDrawHandler['draw'];
    get?: FortuneStateHandler['get'];
    getDetail?: FortuneArchiveHandler['get'];
    list?: FortuneArchiveHandler['list'];
    markViewed?: FortuneViewedHandler['markViewed'];
    telemetry?: FortuneDrawTelemetry;
  } = {},
) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (app) => {
      registerFortuneRoutes(app, {
        archive: { get: handlers.getDetail ?? vi.fn(), list: handlers.list ?? vi.fn() },
        authenticate,
        draw: { draw: handlers.draw ?? vi.fn() },
        state: { get: handlers.get ?? vi.fn() },
        ...(handlers.telemetry === undefined ? {} : { telemetry: handlers.telemetry }),
        viewed: { markViewed: handlers.markViewed ?? vi.fn() },
      });
    },
  });
}

describe('fortune state route', () => {
  it('returns validated non-cacheable authoritative state', async () => {
    const get = vi.fn<FortuneStateHandler['get']>().mockResolvedValue(stateResponse);
    const response = await request(createFixture({ get })).get(apiPaths.fortuneState).expect(200);

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
    const response = await request(createFixture({ get }))
      .get(apiPaths.fortuneState)
      .expect(status);

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
    const response = await request(createFixture({ draw }))
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
    const response = await request(createFixture({ draw }))
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

    await request(createFixture({ draw, telemetry }))
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
      createFixture({ draw, telemetry: { recordIssued: vi.fn(), recordRejected } }),
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

describe('fortune history route', () => {
  const validCursor = `v1.${Buffer.from('{"v":"v1"}').toString('base64url')}.${Buffer.alloc(
    32,
    3,
  ).toString('base64url')}`;
  const historyResponse = {
    items: [drawResponse.draw],
    nextCursor: null,
    syncedAt: '2026-08-06T10:00:00.000Z',
  };

  it('returns one validated non-cacheable page with normalized filters', async () => {
    const list = vi.fn<FortuneArchiveHandler['list']>().mockResolvedValue(historyResponse);
    const response = await request(createFixture({ list }))
      .get(`${apiPaths.fortunes}?limit=50&intention=GROWTH&cursor=${validCursor}`)
      .expect(200);

    expect(response.body).toEqual(historyResponse);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(list).toHaveBeenCalledWith(authentication, {
      cursor: validCursor,
      intention: 'GROWTH',
      limit: 50,
    });
  });

  it('rejects unknown filters, malformed cursors, and reversed ranges before delegation', async () => {
    const list = vi.fn<FortuneArchiveHandler['list']>();
    const fixture = createFixture({ list });

    for (const query of [
      'offset=10',
      'cursor=not-a-cursor',
      'limit=101',
      'issuedFrom=2026-08-07T00:00:00.000Z&issuedTo=2026-08-06T00:00:00.000Z',
    ]) {
      const response = await request(fixture).get(`${apiPaths.fortunes}?${query}`).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('maps a mismatched signed cursor to a validation failure', async () => {
    const list = vi
      .fn<FortuneArchiveHandler['list']>()
      .mockRejectedValue(new FortuneArchiveError('CURSOR_INVALID'));
    const response = await request(createFixture({ list }))
      .get(`${apiPaths.fortunes}?cursor=${validCursor}`)
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('fortune detail route', () => {
  it('returns one owned reading through the handler', async () => {
    const getDetail = vi
      .fn<FortuneArchiveHandler['get']>()
      .mockResolvedValue({ draw: drawResponse.draw });
    const response = await request(createFixture({ getDetail }))
      .get(`/v1/fortunes/${drawResponse.draw.id}`)
      .expect(200);

    expect(response.body).toEqual({ draw: drawResponse.draw });
    expect(getDetail).toHaveBeenCalledWith(authentication, drawResponse.draw.id);
  });

  it('rejects malformed identifiers before delegation', async () => {
    const getDetail = vi.fn<FortuneArchiveHandler['get']>();
    const response = await request(createFixture({ getDetail }))
      .get('/v1/fortunes/not-a-uuid')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(getDetail).not.toHaveBeenCalled();
  });

  it('keeps another account’s reading indistinguishable from absent', async () => {
    const getDetail = vi
      .fn<FortuneArchiveHandler['get']>()
      .mockRejectedValue(new FortuneArchiveError('NOT_FOUND'));
    const response = await request(createFixture({ getDetail }))
      .get(`/v1/fortunes/${drawResponse.draw.id}`)
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body).not.toHaveProperty('draw');
  });
});

describe('fortune viewed route', () => {
  it('acknowledges one owned reading idempotently through the handler', async () => {
    const markViewed = vi.fn<FortuneViewedHandler['markViewed']>().mockResolvedValue({
      draw: { ...drawResponse.draw, viewedAt: '2026-08-06T10:01:00.000Z' },
    });
    const response = await request(createFixture({ markViewed }))
      .patch(`/v1/fortunes/${drawResponse.draw.id}/viewed`)
      .expect(200);

    expect(response.body.draw.viewedAt).toBe('2026-08-06T10:01:00.000Z');
    expect(markViewed).toHaveBeenCalledWith(authentication, drawResponse.draw.id);
  });

  it('rejects malformed identifiers before delegation', async () => {
    const markViewed = vi.fn<FortuneViewedHandler['markViewed']>();
    const response = await request(createFixture({ markViewed }))
      .patch('/v1/fortunes/not-a-uuid/viewed')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(markViewed).not.toHaveBeenCalled();
  });
});
