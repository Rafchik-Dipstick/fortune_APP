import { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  apiPaths,
  collectionCardPath,
  type CollectionCard,
  type CollectionResponse,
} from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { CollectionError } from '../fortune/collection.js';
import { ApiReadiness } from '../health/readiness.js';
import { type CollectionHandler, registerCollectionRoutes } from './collection.js';

const authentication = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionFamilyId: '22222222-2222-4222-8222-222222222222',
  sessionVersion: 1,
  authTimeSeconds: 1_786_000_000,
  authTime: new Date('2026-08-06T10:00:00.000Z'),
};

const authenticate: RequestHandler = (request, _response, next) => {
  request.authentication = authentication;
  next();
};

const suits = ['WANDS', 'CUPS', 'SWORDS', 'PENTACLES'] as const;

function lockedCard(sortOrder: number): CollectionCard {
  const major = sortOrder < 22;
  return {
    key: major
      ? `major-${String(sortOrder).padStart(2, '0')}-card`
      : `${(suits[Math.floor((sortOrder - 22) / 14)] ?? 'WANDS').toLowerCase()}-${String(sortOrder)}`,
    displayNumber: String(sortOrder),
    name: `Card ${String(sortOrder)}`,
    arcana: major ? 'MAJOR' : 'MINOR',
    suit: major ? null : (suits[Math.floor((sortOrder - 22) / 14)] ?? 'WANDS'),
    rank: major ? null : 'ACE',
    artAltText: 'A quiet celestial scene rendered for one canonical tarot card.',
    sortOrder,
    unlocked: false,
    readingCount: 0,
    firstDiscoveredAt: null,
    latestReadingAt: null,
    uprightDiscoveredAt: null,
    reversedDiscoveredAt: null,
  };
}

const collectionResponse: CollectionResponse = {
  cards: Array.from({ length: 78 }, (_, sortOrder) => lockedCard(sortOrder)),
  unlockedCount: 0,
  totalCount: 78,
  syncedAt: '2026-08-06T10:00:00.000Z',
};

function createFixture(handlers: Partial<CollectionHandler> = {}) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    readiness: new ApiReadiness(vi.fn().mockResolvedValue(undefined)),
    configureRoutes: (app) => {
      registerCollectionRoutes(app, {
        authenticate,
        collection: { card: handlers.card ?? vi.fn(), summary: handlers.summary ?? vi.fn() },
      });
    },
  });
}

describe('collection summary route', () => {
  it('returns the validated non-cacheable 78-card summary', async () => {
    const summary = vi.fn<CollectionHandler['summary']>().mockResolvedValue(collectionResponse);
    const response = await request(createFixture({ summary })).get(apiPaths.collection).expect(200);

    expect(response.body).toEqual(collectionResponse);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(summary).toHaveBeenCalledWith(authentication);
  });

  it.each([
    ['AUTH_REQUIRED', 401, 'AUTH_REQUIRED'],
    ['ACCOUNT_DELETION_PENDING', 423, 'ACCOUNT_DELETION_PENDING'],
    ['ACCOUNT_PURGED', 410, 'ACCOUNT_PURGED'],
  ] as const)('maps %s without leaking internal state', async (serviceCode, status, apiCode) => {
    const summary = vi
      .fn<CollectionHandler['summary']>()
      .mockRejectedValue(new CollectionError(serviceCode));
    const response = await request(createFixture({ summary }))
      .get(apiPaths.collection)
      .expect(status);

    expect(response.body.error.code).toBe(apiCode);
    expect(response.body).not.toHaveProperty('cards');
  });
});

describe('collection card route', () => {
  const cardDetail = {
    card: { ...lockedCard(0), key: 'major-00-fool' },
    readings: [],
    nextCursor: null,
    syncedAt: '2026-08-06T10:00:00.000Z',
  };

  it('returns one canonical card page through the handler', async () => {
    const card = vi.fn<CollectionHandler['card']>().mockResolvedValue(cardDetail);
    const response = await request(createFixture({ card }))
      .get(`${collectionCardPath('major-00-fool')}?limit=10`)
      .expect(200);

    expect(response.body).toEqual(cardDetail);
    expect(card).toHaveBeenCalledWith(authentication, 'major-00-fool', { limit: 10 });
  });

  it('rejects malformed card keys and cursors before delegation', async () => {
    const card = vi.fn<CollectionHandler['card']>();
    const fixture = createFixture({ card });

    for (const path of [
      collectionCardPath('Not-A-Key'),
      `${collectionCardPath('major-00-fool')}?cursor=malformed`,
      `${collectionCardPath('major-00-fool')}?limit=0`,
    ]) {
      const response = await request(fixture).get(path).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(card).not.toHaveBeenCalled();
  });

  it('returns not found for an unknown canonical card', async () => {
    const card = vi
      .fn<CollectionHandler['card']>()
      .mockRejectedValue(new CollectionError('NOT_FOUND'));
    const response = await request(createFixture({ card }))
      .get(collectionCardPath('major-99-unknown'))
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
