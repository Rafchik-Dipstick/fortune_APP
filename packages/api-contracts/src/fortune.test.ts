import { describe, expect, it } from 'vitest';

import {
  fortuneDrawRequestSchema,
  fortuneDrawResponseSchema,
  fortuneHistoryQuerySchema,
  fortuneHistoryResponseSchema,
  fortuneStateResponseSchema,
  collectionResponseSchema,
} from './fortune.js';

const state = {
  serverTime: '2026-08-06T10:00:00.000Z',
  freeRemaining: 1,
  subscriptionRemaining: 10,
  spendablePackCredits: 3,
  availableDraws: 14,
  allowancePeriodId: '11111111-1111-4111-8111-111111111111',
  currentPeriodStartedAt: '2026-08-05T21:00:00.000Z',
  nextResetAt: '2026-08-06T21:00:00.000Z',
  accountTimeZone: 'Europe/Kyiv',
  reportedDeviceTimeZone: 'Europe/Kyiv',
  pendingTimeZone: null,
  timeZoneEffectiveAt: null,
  nextTimeZoneChangeEligibleAt: null,
  subscription: {
    status: 'ACTIVE' as const,
    entitled: true,
    paidThrough: '2026-09-06T10:00:00.000Z',
    graceThrough: null,
  },
};

const draw = {
  id: '22222222-2222-4222-8222-222222222222',
  cardKey: 'major-00-fool',
  cardDisplayNumber: '0',
  cardName: 'The Fool',
  orientation: 'UPRIGHT' as const,
  intention: 'GROWTH' as const,
  resolvedLocale: 'en',
  artAltText: 'A traveler steps toward dawn beneath a wandering star.',
  headline: 'Begin before certainty arrives',
  message: 'A gentle opening asks for curiosity rather than certainty.',
  action: 'Give one small beginning ten honest minutes.',
  affirmation: 'I can meet the unknown with curiosity.',
  allowanceSource: 'FREE_DAILY' as const,
  contentVersion: 'development-v1',
  issuedAt: '2026-08-06T10:00:00.000Z',
  viewedAt: null,
};

describe('fortune API contracts', () => {
  it('accepts the complete immutable draw and authoritative allowance state', () => {
    expect(fortuneDrawResponseSchema.parse({ draw, state })).toEqual({ draw, state });
    expect(fortuneStateResponseSchema.parse({ state, unviewedDraw: draw })).toEqual({
      state,
      unviewedDraw: draw,
    });
  });

  it('rejects client-selected cards, locales, and random seeds', () => {
    expect(
      fortuneDrawRequestSchema.safeParse({
        intention: 'GROWTH',
        cardKey: 'major-00-fool',
        locale: 'en',
        seed: 42,
      }).success,
    ).toBe(false);
  });

  it('rejects inconsistent allowance totals and impossible period boundaries', () => {
    expect(
      fortuneStateResponseSchema.safeParse({
        state: { ...state, availableDraws: 99 },
        unviewedDraw: null,
      }).success,
    ).toBe(false);
    expect(
      fortuneStateResponseSchema.safeParse({
        state: { ...state, nextResetAt: state.currentPeriodStartedAt },
        unviewedDraw: null,
      }).success,
    ).toBe(false);
  });

  it('requires a verified boundary for subscription entitlement', () => {
    expect(
      fortuneStateResponseSchema.safeParse({
        state: {
          ...state,
          subscription: {
            status: 'ACTIVE',
            entitled: true,
            paidThrough: null,
            graceThrough: null,
          },
        },
        unviewedDraw: null,
      }).success,
    ).toBe(false);
  });

  it('normalizes bounded history pagination and rejects unknown or reversed filters', () => {
    expect(fortuneHistoryQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(fortuneHistoryQuerySchema.parse({ limit: '100', intention: 'LOVE' })).toEqual({
      limit: 100,
      intention: 'LOVE',
    });
    expect(fortuneHistoryQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(fortuneHistoryQuerySchema.safeParse({ limit: '1', offset: 50 }).success).toBe(false);
    expect(
      fortuneHistoryQuerySchema.safeParse({
        issuedFrom: '2026-08-07T00:00:00.000Z',
        issuedTo: '2026-08-06T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('bounds immutable history pages behind opaque cursor syntax', () => {
    const cursor = `v1.${Buffer.from('payload').toString('base64url')}.${Buffer.alloc(32, 1).toString('base64url')}`;
    expect(
      fortuneHistoryResponseSchema.parse({
        items: [draw],
        nextCursor: cursor,
        syncedAt: state.serverTime,
      }),
    ).toBeDefined();
    expect(
      fortuneHistoryResponseSchema.safeParse({
        items: [draw],
        nextCursor: '2026-08-06T10:00:00.000Z',
        syncedAt: state.serverTime,
      }).success,
    ).toBe(false);
  });

  it('requires an internally consistent canonical 78-card collection', () => {
    const lockedCards = Array.from({ length: 78 }, (_, sortOrder) => ({
      key: `card-${String(sortOrder)}`,
      displayNumber: String(sortOrder),
      name: `Card ${String(sortOrder)}`,
      arcana: sortOrder < 22 ? ('MAJOR' as const) : ('MINOR' as const),
      suit: sortOrder < 22 ? null : ('WANDS' as const),
      rank: sortOrder < 22 ? null : ('ACE' as const),
      artAltText: `Illustration for card ${String(sortOrder)}.`,
      sortOrder,
      unlocked: false,
      readingCount: 0,
      firstDiscoveredAt: null,
      latestReadingAt: null,
      uprightDiscoveredAt: null,
      reversedDiscoveredAt: null,
    }));
    expect(
      collectionResponseSchema.parse({
        cards: lockedCards,
        unlockedCount: 0,
        totalCount: 78,
        syncedAt: state.serverTime,
      }),
    ).toBeDefined();
    expect(
      collectionResponseSchema.safeParse({
        cards: lockedCards.map((card) => ({ ...card, sortOrder: 0 })),
        unlockedCount: 0,
        totalCount: 78,
        syncedAt: state.serverTime,
      }).success,
    ).toBe(false);
  });
});
