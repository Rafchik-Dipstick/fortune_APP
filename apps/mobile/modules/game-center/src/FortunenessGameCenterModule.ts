import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core';

export type GameCenterAuthenticationStatus =
  'AUTHENTICATED' | 'AUTHENTICATING' | 'NOT_STARTED' | 'PRESENTING' | 'UNAVAILABLE' | 'UNSUPPORTED';

export interface GameCenterRestrictions {
  isMultiplayerGamingRestricted: boolean;
  isPersonalizedCommunicationRestricted: boolean;
  isUnderage: boolean;
}

export interface GameCenterPlayerState {
  alias?: string;
  errorCode?: string;
  gamePlayerId?: string;
  isAuthenticated: boolean;
  restrictions: GameCenterRestrictions;
  scopedIdsPersistent: boolean;
  status: GameCenterAuthenticationStatus;
  teamPlayerId?: string;
}

export interface GameCenterIdentityVerificationItems {
  alias: string;
  bundleId: string;
  gamePlayerId: string;
  publicKeyUrl: string;
  restrictions: GameCenterRestrictions;
  saltBase64: string;
  scopedIdsPersistent: boolean;
  signatureBase64: string;
  teamPlayerId: string;
  timestamp: string;
}

interface GameCenterEvents {
  [event: string]: (state: GameCenterPlayerState) => void;
  onAuthenticationChange(state: GameCenterPlayerState): void;
}

declare class GameCenterNativeModule extends NativeModule<GameCenterEvents> {
  fetchIdentityVerificationItemsAsync(): Promise<GameCenterIdentityVerificationItems>;
  getState(): GameCenterPlayerState;
  startAuthenticationAsync(): Promise<GameCenterPlayerState>;
}

const nativeModule = requireOptionalNativeModule<GameCenterNativeModule>('FortunenessGameCenter');

const unsupportedState: GameCenterPlayerState = {
  isAuthenticated: false,
  restrictions: {
    isMultiplayerGamingRestricted: false,
    isPersonalizedCommunicationRestricted: false,
    isUnderage: false,
  },
  scopedIdsPersistent: false,
  status: 'UNSUPPORTED',
};

export function isGameCenterNativeModuleAvailable(): boolean {
  return nativeModule !== null;
}

export function getGameCenterState(): GameCenterPlayerState {
  return nativeModule?.getState() ?? unsupportedState;
}

export function startGameCenterAuthenticationAsync(): Promise<GameCenterPlayerState> {
  return nativeModule?.startAuthenticationAsync() ?? Promise.resolve(unsupportedState);
}

export async function fetchGameCenterIdentityVerificationItemsAsync(): Promise<GameCenterIdentityVerificationItems> {
  if (nativeModule === null) {
    throw new Error('Game Center requires a Fortuneness iOS development build.');
  }
  return nativeModule.fetchIdentityVerificationItemsAsync();
}

export function addGameCenterAuthenticationListener(
  listener: (state: GameCenterPlayerState) => void,
): EventSubscription {
  if (nativeModule === null) {
    return { remove: () => undefined };
  }
  return nativeModule.addListener('onAuthenticationChange', listener);
}
