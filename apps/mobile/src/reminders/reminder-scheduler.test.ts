import { describe, expect, it } from 'vitest';

import {
  reminderIdentifierPrefix,
  requestReminderPermission,
  syncReminderSchedule,
  type ReminderGateway,
  type ReminderPermission,
} from './reminder-scheduler';

class FakeGateway implements ReminderGateway {
  readonly cancelled: string[] = [];
  permissionRequests = 0;
  scheduled: { fireAt: Date; identifier: string }[] = [];

  constructor(
    private permission: ReminderPermission,
    private readonly grantOnRequest: ReminderPermission = 'GRANTED',
    private readonly foreign: string[] = [],
  ) {}

  cancel(identifier: string): Promise<void> {
    this.cancelled.push(identifier);
    this.scheduled = this.scheduled.filter((entry) => entry.identifier !== identifier);
    return Promise.resolve();
  }

  getPermission(): Promise<ReminderPermission> {
    return Promise.resolve(this.permission);
  }

  listScheduledIdentifiers(): Promise<string[]> {
    return Promise.resolve([...this.scheduled.map((entry) => entry.identifier), ...this.foreign]);
  }

  requestPermission(): Promise<ReminderPermission> {
    this.permissionRequests += 1;
    this.permission = this.grantOnRequest;
    return Promise.resolve(this.permission);
  }

  schedule(reminder: { fireAt: Date; identifier: string }): Promise<void> {
    this.scheduled.push(reminder);
    return Promise.resolve();
  }
}

const baseInput = {
  accountTimeZone: 'Europe/Kyiv',
  horizonDays: 3,
  now: new Date('2026-08-07T04:00:00.000Z'),
  reminderEnabled: true,
  reminderLocalMinutes: 9 * 60,
};

describe('syncReminderSchedule', () => {
  it('writes one pending notification per planned day', async () => {
    const gateway = new FakeGateway('GRANTED');

    const result = await syncReminderSchedule(gateway, baseInput);

    expect(result).toMatchObject({ kind: 'SCHEDULED', count: 3, timeZone: 'Europe/Kyiv' });
    expect(gateway.scheduled).toHaveLength(3);
    expect(gateway.scheduled[0]?.identifier).toBe(
      `${reminderIdentifierPrefix}2026-08-07T06:00:00.000Z`,
    );
    expect(gateway.permissionRequests).toBe(0);
  });

  it('replaces the previous run rather than stacking onto it', async () => {
    const gateway = new FakeGateway('GRANTED');
    await syncReminderSchedule(gateway, baseInput);

    await syncReminderSchedule(gateway, { ...baseInput, reminderLocalMinutes: 20 * 60 });

    expect(gateway.scheduled).toHaveLength(3);
    expect(gateway.scheduled.every((entry) => entry.fireAt.toISOString().includes('T17:00'))).toBe(
      true,
    );
  });

  it('leaves notifications it does not own alone', async () => {
    const gateway = new FakeGateway('GRANTED', 'GRANTED', ['some-other-feature.1']);

    await syncReminderSchedule(gateway, { ...baseInput, reminderEnabled: false });

    expect(gateway.cancelled).not.toContain('some-other-feature.1');
  });

  it('clears the schedule when the reminder is switched off', async () => {
    const gateway = new FakeGateway('GRANTED');
    await syncReminderSchedule(gateway, baseInput);

    const result = await syncReminderSchedule(gateway, { ...baseInput, reminderEnabled: false });

    expect(result).toEqual({ kind: 'CLEARED', reason: 'DISABLED' });
    expect(gateway.scheduled).toHaveLength(0);
  });

  it('clears the schedule and never prompts when permission is missing', async () => {
    const gateway = new FakeGateway('DENIED');

    const result = await syncReminderSchedule(gateway, baseInput);

    expect(result).toEqual({ kind: 'CLEARED', reason: 'PERMISSION_MISSING' });
    expect(gateway.permissionRequests).toBe(0);
    expect(gateway.scheduled).toHaveLength(0);
  });

  it('reports an unavailable notification runtime instead of failing', async () => {
    expect(await syncReminderSchedule(undefined, baseInput)).toEqual({
      kind: 'CLEARED',
      reason: 'UNAVAILABLE',
    });
  });
});

describe('requestReminderPermission', () => {
  it('prompts once when the player has not been asked yet', async () => {
    const gateway = new FakeGateway('UNDETERMINED');

    expect(await requestReminderPermission(gateway)).toBe('GRANTED');
    expect(gateway.permissionRequests).toBe(1);
  });

  it('does not re-prompt after iOS has recorded a denial', async () => {
    const gateway = new FakeGateway('DENIED');

    expect(await requestReminderPermission(gateway)).toBe('DENIED');
    expect(gateway.permissionRequests).toBe(0);
  });
});
