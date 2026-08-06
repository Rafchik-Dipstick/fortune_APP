import { describe, expect, it } from 'vitest';

import {
  canonicalizeIanaTimeZone,
  getAccountDayBounds,
  planMaterialTimeZoneChange,
} from './account-day.js';

describe('account-day boundaries', () => {
  it('returns exact half-open UTC day boundaries', () => {
    const bounds = getAccountDayBounds(new Date('2026-08-06T12:34:56.789Z'), 'UTC');

    expect(bounds).toEqual({
      startedAt: new Date('2026-08-06T00:00:00.000Z'),
      nextResetAt: new Date('2026-08-07T00:00:00.000Z'),
      timeZone: 'UTC',
    });
  });

  it('uses the short spring DST day without inventing an intermediate reset', () => {
    const bounds = getAccountDayBounds(new Date('2026-03-29T00:30:00.000Z'), 'Europe/Kyiv');

    expect(bounds.startedAt.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    expect(bounds.nextResetAt.toISOString()).toBe('2026-03-29T21:00:00.000Z');
    expect(bounds.nextResetAt.getTime() - bounds.startedAt.getTime()).toBe(23 * 3_600_000);
  });

  it('uses the long autumn DST day across a repeated local hour', () => {
    const bounds = getAccountDayBounds(new Date('2026-10-25T00:30:00.000Z'), 'Europe/Kyiv');

    expect(bounds.startedAt.toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(bounds.nextResetAt.toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(bounds.nextResetAt.getTime() - bounds.startedAt.getTime()).toBe(25 * 3_600_000);
  });

  it('suppresses both earlier eastbound and westbound candidate resets', () => {
    const now = new Date('2026-08-06T10:00:00.000Z');
    const oldReset = new Date('2026-08-06T21:00:00.000Z');

    expect(
      planMaterialTimeZoneChange({
        currentPeriodResetAt: oldReset,
        now,
        requestedTimeZone: 'Asia/Tokyo',
      }).timeZoneEffectiveAt.toISOString(),
    ).toBe('2026-08-06T21:00:00.000Z');
    expect(
      planMaterialTimeZoneChange({
        currentPeriodResetAt: oldReset,
        now,
        requestedTimeZone: 'America/Los_Angeles',
      }).timeZoneEffectiveAt.toISOString(),
    ).toBe('2026-08-07T07:00:00.000Z');
  });

  it('canonicalizes aliases and rejects unknown identifiers', () => {
    expect(canonicalizeIanaTimeZone('US/Pacific')).toBe('America/Los_Angeles');
    expect(() => canonicalizeIanaTimeZone('Moon/Tranquility')).toThrow('recognized IANA');
  });
});
