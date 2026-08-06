import { describe, expect, it, vi } from 'vitest';
import type {
  FortuneAllowanceState,
  FortuneDraw,
  FortuneDrawResponse,
} from '@fortuneness/api-contracts';

import { MobileApiError } from '../auth/api-client';
import { DrawAttemptController } from './draw-attempt';

const draw: FortuneDraw = {
  id: '3a22ad64-e8f6-4e1a-9933-29ec6f5e86c6',
  cardKey: 'major-00-fool',
  cardDisplayNumber: '0',
  cardName: 'The Fool',
  orientation: 'UPRIGHT',
  intention: 'GROWTH',
  resolvedLocale: 'en',
  artAltText: 'A traveler steps toward dawn beneath a bright wandering star.',
  headline: 'Begin before certainty arrives',
  message: 'A beginning may be asking for your attention before every detail is settled.',
  action: 'Choose one small beginning and give it ten honest minutes.',
  affirmation: 'I can meet the unknown with curiosity.',
  allowanceSource: 'FREE_DAILY',
  contentVersion: '2026.08.06',
  issuedAt: '2026-08-06T10:00:00.000Z',
  viewedAt: null,
};

const state: FortuneAllowanceState = {
  serverTime: '2026-08-06T10:00:00.000Z',
  freeRemaining: 0,
  subscriptionRemaining: 0,
  spendablePackCredits: 0,
  availableDraws: 0,
  allowancePeriodId: '20ba3675-a2f6-4a41-897a-f2532f23e10f',
  currentPeriodStartedAt: '2026-08-05T21:00:00.000Z',
  nextResetAt: '2026-08-06T21:00:00.000Z',
  accountTimeZone: 'Europe/Kyiv',
  reportedDeviceTimeZone: 'Europe/Kyiv',
  pendingTimeZone: null,
  timeZoneEffectiveAt: null,
  nextTimeZoneChangeEligibleAt: null,
  subscription: {
    status: 'NONE',
    entitled: false,
    paidThrough: null,
    graceThrough: null,
  },
};

const response: FortuneDrawResponse = { draw, state };

describe('DrawAttemptController', () => {
  it('ignores additional taps while one keyed draw is in flight', async () => {
    const pending = Promise.withResolvers<FortuneDrawResponse>();
    const drawRequest = vi.fn().mockReturnValue(pending.promise);
    const controller = new DrawAttemptController({
      createUuid: () => '8291675b-5ca2-4c96-bdb6-59b41900e4b7',
      draw: drawRequest,
    });

    const first = controller.execute('account-a', 'token-a', 'GENERAL');
    await expect(controller.execute('account-a', 'token-a', 'LOVE')).resolves.toEqual({
      kind: 'IGNORED_IN_FLIGHT',
    });
    expect(drawRequest).toHaveBeenCalledOnce();

    pending.resolve(response);
    await expect(first).resolves.toEqual({ kind: 'DRAW_ISSUED', response });
  });

  it('retries an ambiguous failure with the exact key and original intention', async () => {
    const drawRequest = vi
      .fn()
      .mockRejectedValueOnce(
        new MobileApiError({
          code: 'NETWORK_UNAVAILABLE',
          message: 'offline',
          retryable: true,
          sameKeyRetrySafe: true,
        }),
      )
      .mockResolvedValueOnce(response);
    const createUuid = vi.fn().mockReturnValue('8291675b-5ca2-4c96-bdb6-59b41900e4b7');
    const controller = new DrawAttemptController({ createUuid, draw: drawRequest });

    await expect(controller.execute('account-a', 'token-a', 'GROWTH')).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
    });
    expect(controller.retainedIntention).toBe('GROWTH');
    await expect(controller.execute('account-a', 'token-b', 'LOVE')).resolves.toMatchObject({
      kind: 'DRAW_ISSUED',
    });

    expect(createUuid).toHaveBeenCalledOnce();
    expect(drawRequest.mock.calls).toEqual([
      ['token-a', { intention: 'GROWTH' }, '8291675b-5ca2-4c96-bdb6-59b41900e4b7'],
      ['token-b', { intention: 'GROWTH' }, '8291675b-5ca2-4c96-bdb6-59b41900e4b7'],
    ]);
  });

  it('starts a new key only after a prior issued draw completed', async () => {
    const createUuid = vi
      .fn()
      .mockReturnValueOnce('8291675b-5ca2-4c96-bdb6-59b41900e4b7')
      .mockReturnValueOnce('4e6df064-98fd-4748-b31d-699653ce2437');
    const drawRequest = vi.fn().mockResolvedValue(response);
    const controller = new DrawAttemptController({ createUuid, draw: drawRequest });

    await controller.execute('account-a', 'token-a', 'GENERAL');
    await controller.execute('account-a', 'token-a', 'LOVE');

    expect(drawRequest.mock.calls[0]?.[2]).not.toBe(drawRequest.mock.calls[1]?.[2]);
  });

  it('never carries an ambiguous key or intention into another account', async () => {
    const drawRequest = vi
      .fn()
      .mockRejectedValueOnce(
        new MobileApiError({
          code: 'NETWORK_UNAVAILABLE',
          message: 'offline',
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(response);
    const createUuid = vi
      .fn()
      .mockReturnValueOnce('8291675b-5ca2-4c96-bdb6-59b41900e4b7')
      .mockReturnValueOnce('4e6df064-98fd-4748-b31d-699653ce2437');
    const controller = new DrawAttemptController({ createUuid, draw: drawRequest });

    await expect(controller.execute('account-a', 'token-a', 'GROWTH')).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
    });
    await controller.execute('account-b', 'token-b', 'LOVE');

    expect(drawRequest.mock.calls[1]).toEqual([
      'token-b',
      { intention: 'LOVE' },
      '4e6df064-98fd-4748-b31d-699653ce2437',
    ]);
  });

  it('converts the owned pending draw terminal outcome into a resumable result', async () => {
    const controller = new DrawAttemptController({
      createUuid: () => '8291675b-5ca2-4c96-bdb6-59b41900e4b7',
      draw: vi.fn().mockRejectedValue(
        new MobileApiError({
          code: 'UNVIEWED_READING_PENDING',
          details: { state, unviewedDraw: draw },
          message: 'continue',
          retryable: false,
          sameKeyRetrySafe: true,
        }),
      ),
    });

    await expect(controller.execute('account-a', 'token-a', 'GENERAL')).resolves.toEqual({
      kind: 'DRAW_ALREADY_ISSUED',
      details: { state, unviewedDraw: draw },
    });
    expect(controller.retainedIntention).toBeUndefined();
  });

  it('converts authoritative allowance exhaustion without retaining the key', async () => {
    const controller = new DrawAttemptController({
      createUuid: () => '8291675b-5ca2-4c96-bdb6-59b41900e4b7',
      draw: vi.fn().mockRejectedValue(
        new MobileApiError({
          code: 'NO_DRAWS_AVAILABLE',
          details: { state },
          message: 'empty',
          retryable: false,
          sameKeyRetrySafe: true,
        }),
      ),
    });

    await expect(controller.execute('account-a', 'token-a', 'GENERAL')).resolves.toEqual({
      kind: 'ALLOWANCE_EXHAUSTED',
      details: { state },
    });
    expect(controller.retainedIntention).toBeUndefined();
  });
});
