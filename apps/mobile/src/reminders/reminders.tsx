import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { PreferencesUpdateRequest, UserPreferences } from '@fortuneness/api-contracts';

import { useAuthentication } from '../auth/authentication';
import { MobileApiError, updatePreferences } from '../auth/api-client';
import { configureReminderPresentation, getReminderGateway } from './expo-reminder-gateway';
import {
  requestReminderPermission,
  syncReminderSchedule,
  type ReminderPermission,
  type ReminderSyncResult,
} from './reminder-scheduler';

export type ReminderOptInResult =
  | { kind: 'ENABLED' }
  | { kind: 'PERMISSION_DENIED' }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'FAILED'; message: string };

interface RemindersContextValue {
  isBusy: boolean;
  nextReminderAt: Date | undefined;
  permission: ReminderPermission;
  preferences: UserPreferences;
  scheduledCount: number;
  disableReminder: () => Promise<void>;
  enableReminder: () => Promise<ReminderOptInResult>;
  setReminderTime: (localMinutes: number) => Promise<ReminderOptInResult>;
}

const RemindersContext = createContext<RemindersContextValue | undefined>(undefined);

function failureMessage(error: unknown): string {
  if (error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE') {
    return 'The reminder setting needs a connection to save. Nothing was changed.';
  }
  return 'The reminder setting could not be saved. Nothing was changed; try again in a moment.';
}

export function RemindersProvider({ children }: { children: ReactNode }) {
  const authentication = useAuthentication();
  if (authentication.phase !== 'AUTHENTICATED' || authentication.session === undefined) {
    throw new Error('RemindersProvider requires an authenticated session.');
  }
  const session = authentication.session;
  const { applyAccountUpdate } = authentication;
  const gateway = useMemo(getReminderGateway, []);
  const [permission, setPermission] = useState<ReminderPermission>('UNDETERMINED');
  const [sync, setSync] = useState<ReminderSyncResult>({ kind: 'CLEARED', reason: 'DISABLED' });
  const [isBusy, setIsBusy] = useState(false);
  const accessToken = useRef(session.accessToken);

  useEffect(() => {
    accessToken.current = session.accessToken;
  }, [session.accessToken]);

  useEffect(configureReminderPresentation, []);

  const user = session.user;
  const scheduleInput = useMemo(
    () => ({
      accountTimeZone: user.accountTimeZone,
      pendingTimeZone: user.pendingTimeZone,
      reminderEnabled: user.preferences.reminderEnabled,
      reminderLocalMinutes: user.preferences.reminderLocalMinutes,
      timeZoneEffectiveAt: user.timeZoneEffectiveAt,
    }),
    [
      user.accountTimeZone,
      user.pendingTimeZone,
      user.preferences.reminderEnabled,
      user.preferences.reminderLocalMinutes,
      user.timeZoneEffectiveAt,
    ],
  );

  const refresh = useCallback(async () => {
    if (gateway !== undefined) {
      setPermission(await gateway.getPermission());
    }
    setSync(await syncReminderSchedule(gateway, { ...scheduleInput, now: new Date() }));
  }, [gateway, scheduleInput]);

  // The one-shots are rewritten at launch, whenever the preference or the
  // account zone moves, and every time the app returns to the foreground —
  // which is also how a device clock or zone change is picked up.
  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) {
        void refresh().catch(() => undefined);
      }
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        run();
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [refresh]);

  const savePreferences = useCallback(
    async (update: PreferencesUpdateRequest): Promise<ReminderOptInResult> => {
      setIsBusy(true);
      try {
        const response = await updatePreferences(accessToken.current, update);
        applyAccountUpdate({
          ...user,
          ...response.timeZoneState,
          preferences: response.preferences,
        });
        return { kind: 'ENABLED' };
      } catch (error) {
        return { kind: 'FAILED', message: failureMessage(error) };
      } finally {
        setIsBusy(false);
      }
    },
    [applyAccountUpdate, user],
  );

  /** The only path that may raise the iOS permission prompt. */
  const enableReminder = useCallback(async (): Promise<ReminderOptInResult> => {
    if (gateway === undefined) {
      return { kind: 'UNAVAILABLE' };
    }
    const granted = await requestReminderPermission(gateway);
    setPermission(granted);
    if (granted !== 'GRANTED') {
      return { kind: 'PERMISSION_DENIED' };
    }
    const saved = await savePreferences({ reminderEnabled: true });
    if (saved.kind === 'ENABLED') {
      await refresh();
    }
    return saved;
  }, [gateway, refresh, savePreferences]);

  const disableReminder = useCallback(async () => {
    await savePreferences({ reminderEnabled: false });
    await refresh();
  }, [refresh, savePreferences]);

  const setReminderTime = useCallback(
    async (localMinutes: number): Promise<ReminderOptInResult> => {
      const saved = await savePreferences({ reminderLocalMinutes: localMinutes });
      if (saved.kind === 'ENABLED') {
        await refresh();
      }
      return saved;
    },
    [refresh, savePreferences],
  );

  const value = useMemo<RemindersContextValue>(
    () => ({
      disableReminder,
      enableReminder,
      isBusy,
      nextReminderAt: sync.kind === 'SCHEDULED' ? sync.nextFireAt : undefined,
      permission,
      preferences: user.preferences,
      scheduledCount: sync.kind === 'SCHEDULED' ? sync.count : 0,
      setReminderTime,
    }),
    [disableReminder, enableReminder, isBusy, permission, setReminderTime, sync, user.preferences],
  );

  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}

export function useReminders(): RemindersContextValue {
  const value = useContext(RemindersContext);
  if (value === undefined) {
    throw new Error('useReminders must be used inside RemindersProvider.');
  }
  return value;
}
