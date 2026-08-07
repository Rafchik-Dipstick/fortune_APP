import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import {
  reminderNotification,
  type ReminderGateway,
  type ReminderPermission,
} from './reminder-scheduler';

function mapPermission(status: Notifications.NotificationPermissionsStatus): ReminderPermission {
  if (status.granted) {
    return 'GRANTED';
  }
  return status.canAskAgain && status.status === Notifications.PermissionStatus.UNDETERMINED
    ? 'UNDETERMINED'
    : 'DENIED';
}

const expoReminderGateway: ReminderGateway = {
  async cancel(identifier) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },

  async getPermission() {
    return mapPermission(await Notifications.getPermissionsAsync());
  },

  async listScheduledIdentifiers() {
    return (await Notifications.getAllScheduledNotificationsAsync()).map(
      (request) => request.identifier,
    );
  },

  async requestPermission() {
    return mapPermission(
      await Notifications.requestPermissionsAsync({
        // Fortuneness asks for the quietest useful set: no badge, no critical
        // alerts, and nothing that can appear in CarPlay.
        ios: { allowAlert: true, allowBadge: false, allowSound: true },
      }),
    );
  },

  async schedule({ fireAt, identifier }) {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        body: reminderNotification.body,
        // A daily reflection arrives quietly; the banner is the whole point.
        sound: false,
        title: reminderNotification.title,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  },
};

/**
 * Undefined wherever local notifications are not available (Expo Go, the web
 * preview, or a test renderer), so the scheduler degrades to reporting the
 * reminder as unavailable instead of throwing.
 */
export function getReminderGateway(): ReminderGateway | undefined {
  if (Platform.OS !== 'ios') {
    return undefined;
  }
  return typeof Notifications.scheduleNotificationAsync === 'function'
    ? expoReminderGateway
    : undefined;
}

/**
 * A reminder that arrives while the app is open should not cover the reading
 * the player already has in front of them.
 */
export function configureReminderPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: true,
      }),
  });
}
