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
import * as AppleAuthentication from 'expo-apple-authentication';
import { getCalendars, getLocales } from 'expo-localization';
import type { DeletionManagement, AppleAuthResponse, MeResponse } from '@fortuneness/api-contracts';

import {
  authenticateApple,
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

interface AuthenticationContextValue extends AuthenticationState {
  applyAccountUpdate: (user: MeResponse['user']) => void;
  disconnect: () => Promise<void>;
  enterDeletionPending: (deletionManagement?: DeletionManagement) => Promise<void>;
  reauthenticate: () => Promise<boolean>;
  resumeAfterDeletionCancelled: (response: AppleAuthResponse) => Promise<void>;
  retry: () => Promise<void>;
}

const AuthenticationContext = createContext<AuthenticationContextValue | undefined>(undefined);

function createCoordinator(): AuthenticationCoordinator {
  return new AuthenticationCoordinator({
    api: {
      authenticate: authenticateApple,
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
    fingerprint: (appleUserId) =>
      Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `sign-in-with-apple:${appleUserId}`,
      ),
    native: {
      isAvailable: AppleAuthentication.isAvailableAsync,
      signIn: async (nonce) => {
        const credential = await AppleAuthentication.signInAsync({ nonce });
        return { identityToken: credential.identityToken, user: credential.user };
      },
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
    (response: AppleAuthResponse) => coordinator.resumeAfterDeletionCancelled(response),
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
