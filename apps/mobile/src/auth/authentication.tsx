import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as Crypto from 'expo-crypto';
import { getCalendars, getLocales } from 'expo-localization';
import type {
  DeletionManagement,
  GameCenterAuthResponse,
  MeResponse,
} from '@fortuneness/api-contracts';

import {
  addGameCenterAuthenticationListener,
  fetchGameCenterIdentityVerificationItemsAsync,
  startGameCenterAuthenticationAsync,
} from '../../modules/game-center';
import {
  authenticateGameCenter,
  getAccountBootstrap,
  logoutSession,
  refreshSession,
} from './api-client';
import { AuthenticationCoordinator, type AuthenticationState } from './authentication-coordinator';
import {
  getOrCreateDeviceId,
  loadStoredCredentials,
  saveStoredCredentials,
} from './session-storage';
import { clearAllLocalAccountData } from '../local-data/account-cleanup';
import { publicEnvironment } from '../config/public-environment';

interface AuthenticationContextValue extends AuthenticationState {
  applyAccountUpdate: (user: MeResponse['user']) => void;
  disconnect: () => Promise<void>;
  enterDeletionPending: (deletionManagement?: DeletionManagement) => Promise<void>;
  reauthenticate: () => Promise<boolean>;
  resumeAfterDeletionCancelled: (response: GameCenterAuthResponse) => Promise<void>;
  retry: () => Promise<void>;
}

const AuthenticationContext = createContext<AuthenticationContextValue | undefined>(undefined);

function createCoordinator(): AuthenticationCoordinator {
  return new AuthenticationCoordinator({
    // Deliberately not gated on `__DEV__`: an EAS build embeds a
    // production-mode bundle, so `__DEV__` is false whenever the application
    // runs from its own binary rather than from Metro, which silently disabled
    // this on the very builds that need it. The real fence is the server, which
    // refuses the same allowance unless its deployment is `local`; preview and
    // production builds also resolve a different app environment here.
    allowNonPersistentIds: publicEnvironment.appEnvironment === 'development',
    api: {
      authenticate: authenticateGameCenter,
      bootstrap: getAccountBootstrap,
      logout: logoutSession,
      refresh: refreshSession,
    },
    clearAccountData: clearAllLocalAccountData,
    createUuid: Crypto.randomUUID,
    deviceContext: () => ({
      locale: getLocales()[0].languageTag,
      timeZone: getCalendars()[0].timeZone ?? 'UTC',
    }),
    fingerprint: (teamPlayerId) =>
      Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `game-center-team:${teamPlayerId}`,
      ),
    native: {
      fetchProof: fetchGameCenterIdentityVerificationItemsAsync,
      start: startGameCenterAuthenticationAsync,
      subscribe: addGameCenterAuthenticationListener,
    },
    storage: {
      getDeviceId: getOrCreateDeviceId,
      load: loadStoredCredentials,
      save: saveStoredCredentials,
    },
  });
}

export function AuthenticationProvider({ children }: { children: ReactNode }) {
  const coordinator = useMemo(createCoordinator, []);
  const [state, setState] = useState<AuthenticationState>(coordinator.state);

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState);
    void coordinator.start();
    return () => {
      unsubscribe();
      coordinator.stop();
    };
  }, [coordinator]);

  const retry = useCallback(() => coordinator.retry(), [coordinator]);
  const disconnect = useCallback(() => coordinator.disconnect(), [coordinator]);
  const applyAccountUpdate = useCallback(
    (user: MeResponse['user']) => {
      coordinator.applyAccountUpdate(user);
    },
    [coordinator],
  );
  const enterDeletionPending = useCallback(
    (deletionManagement?: DeletionManagement) =>
      coordinator.enterDeletionPending(deletionManagement),
    [coordinator],
  );
  const reauthenticate = useCallback(() => coordinator.reauthenticate(), [coordinator]);
  const resumeAfterDeletionCancelled = useCallback(
    (response: GameCenterAuthResponse) => coordinator.resumeAfterDeletionCancelled(response),
    [coordinator],
  );
  const value = useMemo(
    () => ({
      ...state,
      applyAccountUpdate,
      disconnect,
      enterDeletionPending,
      reauthenticate,
      resumeAfterDeletionCancelled,
      retry,
    }),
    [
      applyAccountUpdate,
      disconnect,
      enterDeletionPending,
      reauthenticate,
      resumeAfterDeletionCancelled,
      retry,
      state,
    ],
  );

  return <AuthenticationContext.Provider value={value}>{children}</AuthenticationContext.Provider>;
}

export function useAuthentication(): AuthenticationContextValue {
  const value = useContext(AuthenticationContext);
  if (value === undefined) {
    throw new Error('useAuthentication must be used inside AuthenticationProvider.');
  }
  return value;
}
