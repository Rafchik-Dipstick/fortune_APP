import { planReminderSchedule, type ReminderScheduleInput } from './reminder-schedule';

/**
 * Every notification Fortuneness owns carries this prefix, so a refresh
 * cancels only its own pending reminders and never anything else the system
 * is holding for the app.
 */
export const reminderIdentifierPrefix = 'fortuneness.daily-reminder.';

export const reminderNotification = {
  body: 'A card is waiting whenever you have a quiet moment.',
  title: 'Your daily reading is ready',
} as const;

export type ReminderPermission = 'GRANTED' | 'DENIED' | 'UNDETERMINED';

export interface ReminderGateway {
  cancel(identifier: string): Promise<void>;
  getPermission(): Promise<ReminderPermission>;
  listScheduledIdentifiers(): Promise<string[]>;
  requestPermission(): Promise<ReminderPermission>;
  schedule(reminder: { fireAt: Date; identifier: string }): Promise<void>;
}

export type ReminderSyncResult =
  | { kind: 'CLEARED'; reason: 'DISABLED' | 'PERMISSION_MISSING' | 'UNAVAILABLE' }
  | { kind: 'SCHEDULED'; count: number; nextFireAt: Date; timeZone: string };

export function reminderIdentifier(fireAt: Date): string {
  return `${reminderIdentifierPrefix}${fireAt.toISOString()}`;
}

async function cancelOwnReminders(gateway: ReminderGateway): Promise<void> {
  const identifiers = await gateway.listScheduledIdentifiers();
  for (const identifier of identifiers) {
    if (identifier.startsWith(reminderIdentifierPrefix)) {
      await gateway.cancel(identifier);
    }
  }
}

/**
 * Rewrites the pending one-shots to match the plan. It never asks for
 * notification permission: the only place that may prompt is
 * {@link requestReminderPermission}, reached from an explicit opt-in.
 */
export async function syncReminderSchedule(
  gateway: ReminderGateway | undefined,
  input: ReminderScheduleInput,
): Promise<ReminderSyncResult> {
  if (gateway === undefined) {
    return { kind: 'CLEARED', reason: 'UNAVAILABLE' };
  }
  if (!input.reminderEnabled) {
    await cancelOwnReminders(gateway);
    return { kind: 'CLEARED', reason: 'DISABLED' };
  }
  if ((await gateway.getPermission()) !== 'GRANTED') {
    // Permission can be revoked in iOS Settings at any time. Dropping the
    // pending one-shots keeps the app from claiming a reminder it cannot send.
    await cancelOwnReminders(gateway);
    return { kind: 'CLEARED', reason: 'PERMISSION_MISSING' };
  }

  const schedule = planReminderSchedule(input);
  await cancelOwnReminders(gateway);
  const first = schedule[0];
  if (first === undefined) {
    return { kind: 'CLEARED', reason: 'DISABLED' };
  }
  for (const occurrence of schedule) {
    await gateway.schedule({
      fireAt: occurrence.fireAt,
      identifier: reminderIdentifier(occurrence.fireAt),
    });
  }
  return {
    kind: 'SCHEDULED',
    count: schedule.length,
    nextFireAt: first.fireAt,
    timeZone: first.timeZone,
  };
}

/**
 * Asks iOS for notification permission. Called only from an explicit opt-in;
 * an already-denied prompt is not raised again, since iOS shows the system
 * dialog once and the player has to change it in Settings afterwards.
 */
export async function requestReminderPermission(
  gateway: ReminderGateway | undefined,
): Promise<ReminderPermission> {
  if (gateway === undefined) {
    return 'DENIED';
  }
  const current = await gateway.getPermission();
  return current === 'UNDETERMINED' ? gateway.requestPermission() : current;
}
