import { describe, expect, it } from 'vitest';

import {
  defaultReminderHorizonDays,
  formatReminderTime,
  planReminderSchedule,
} from './reminder-schedule';

/** Wall clock in a zone, so assertions read the way a person reads a clock. */
function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(instant);
}

const nineAm = 9 * 60;

describe('planReminderSchedule', () => {
  it('schedules nothing while the reminder is off', () => {
    expect(
      planReminderSchedule({
        accountTimeZone: 'Europe/Kyiv',
        now: new Date('2026-08-07T06:00:00.000Z'),
        reminderEnabled: false,
        reminderLocalMinutes: nineAm,
      }),
    ).toEqual([]);
  });

  it('fills the horizon with one local occurrence per day', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'Europe/Kyiv',
      now: new Date('2026-08-07T04:00:00.000Z'),
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
    });

    expect(schedule).toHaveLength(defaultReminderHorizonDays);
    for (const occurrence of schedule) {
      expect(localTime(occurrence.fireAt, 'Europe/Kyiv')).toMatch(/ 09:00$/);
      expect(occurrence.timeZone).toBe('Europe/Kyiv');
    }
    // 09:00 Kyiv is 06:00 UTC in summer, and today still counts.
    expect(schedule[0]?.fireAt.toISOString()).toBe('2026-08-07T06:00:00.000Z');
  });

  it('skips today once its local time has passed', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'Europe/Kyiv',
      now: new Date('2026-08-07T06:00:01.000Z'),
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
    });

    expect(schedule[0]?.fireAt.toISOString()).toBe('2026-08-08T06:00:00.000Z');
  });

  it('holds the wall-clock time across a daylight-saving change', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'America/New_York',
      horizonDays: 4,
      // US clocks move forward on 8 March 2026.
      now: new Date('2026-03-06T12:00:00.000Z'),
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
    });

    expect(schedule.map((occurrence) => occurrence.fireAt.toISOString())).toEqual([
      '2026-03-06T14:00:00.000Z',
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
    for (const occurrence of schedule) {
      expect(localTime(occurrence.fireAt, 'America/New_York')).toMatch(/ 09:00$/);
    }
  });

  it('rolls a reminder that the spring-forward gap deletes to the next real minute', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'America/New_York',
      horizonDays: 3,
      now: new Date('2026-03-07T12:00:00.000Z'),
      reminderEnabled: true,
      // 02:30 never happens on 8 March 2026 in New York.
      reminderLocalMinutes: 2 * 60 + 30,
    });

    const missing = schedule.find(
      (occurrence) => occurrence.fireAt.toISOString() > '2026-03-08T00:00:00.000Z',
    );
    expect(missing?.fireAt.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(localTime(missing?.fireAt ?? new Date(0), 'America/New_York')).toMatch(/ 03:30$/);
  });

  it('hands over to the pending zone at the effective instant', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'Europe/Kyiv',
      horizonDays: 6,
      now: new Date('2026-08-07T04:00:00.000Z'),
      pendingTimeZone: 'America/Los_Angeles',
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
      timeZoneEffectiveAt: '2026-08-09T07:00:00.000Z',
    });

    const handoverMs = Date.parse('2026-08-09T07:00:00.000Z');
    const zones = new Set(schedule.map((occurrence) => occurrence.timeZone));
    expect(zones).toEqual(new Set(['Europe/Kyiv', 'America/Los_Angeles']));

    // Every occurrence still lands at 09:00 on the clock that owns it, and the
    // effective instant is the only thing that decides which clock that is.
    for (const occurrence of schedule) {
      expect(localTime(occurrence.fireAt, occurrence.timeZone)).toMatch(/ 09:00$/);
      expect(occurrence.fireAt.getTime()).toBeGreaterThan(Date.parse('2026-08-07T04:00:00.000Z'));
      expect(occurrence.timeZone).toBe(
        occurrence.fireAt.getTime() < handoverMs ? 'Europe/Kyiv' : 'America/Los_Angeles',
      );
    }
  });

  it('never reminds twice inside the same stretch of a day at the handover', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'Pacific/Auckland',
      horizonDays: 5,
      now: new Date('2026-08-07T00:00:00.000Z'),
      pendingTimeZone: 'America/Los_Angeles',
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
      timeZoneEffectiveAt: '2026-08-08T12:00:00.000Z',
    });

    const gaps = schedule
      .slice(1)
      .map(
        (occurrence, index) =>
          occurrence.fireAt.getTime() - (schedule[index]?.fireAt.getTime() ?? 0),
      );
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(12 * 3_600_000);
    }
  });

  it('ignores a pending zone the server has not made effective yet', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'Europe/Kyiv',
      horizonDays: 3,
      now: new Date('2026-08-07T04:00:00.000Z'),
      pendingTimeZone: 'America/Los_Angeles',
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
      timeZoneEffectiveAt: null,
    });

    expect(new Set(schedule.map((occurrence) => occurrence.timeZone))).toEqual(
      new Set(['Europe/Kyiv']),
    );
  });

  it('treats a handover already in the past as the account zone', () => {
    const schedule = planReminderSchedule({
      accountTimeZone: 'America/Los_Angeles',
      horizonDays: 3,
      now: new Date('2026-08-07T04:00:00.000Z'),
      pendingTimeZone: 'America/Los_Angeles',
      reminderEnabled: true,
      reminderLocalMinutes: nineAm,
      timeZoneEffectiveAt: '2026-08-01T00:00:00.000Z',
    });

    expect(new Set(schedule.map((occurrence) => occurrence.timeZone))).toEqual(
      new Set(['America/Los_Angeles']),
    );
  });
});

describe('formatReminderTime', () => {
  it('states the hour the way the settings row does', () => {
    expect(formatReminderTime(0)).toBe('12:00 AM');
    expect(formatReminderTime(nineAm)).toBe('9:00 AM');
    expect(formatReminderTime(12 * 60)).toBe('12:00 PM');
    expect(formatReminderTime(21 * 60 + 5)).toBe('9:05 PM');
    expect(formatReminderTime(1_439)).toBe('11:59 PM');
  });
});
