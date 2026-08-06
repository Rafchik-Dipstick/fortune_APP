import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GameCenterAuthRequest,
  GameCenterAuthResponse,
  MeResponse,
  RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import type {
  GameCenterIdentityVerificationItems,
  GameCenterPlayerState,
} from '../../modules/game-center';
import {
  AuthenticationCoordinator,
  type AuthenticationCoordinatorDependencies,
} from './authentication-coordinator';
import { MobileApiError } from './api-client';
import type { StoredCredentials } from './session-storage';

const playerState = (teamPlayerId: string): GameCenterPlayerState => ({
  status: 'AUTHENTICATED',
  isAuthenticated: true,
  scopedIdsPersistent: true,
  teamPlayerId,
  gamePlayerId: `game-${teamPlayerId}`,
  alias: `Alias ${teamPlayerId}`,
  restrictions: {
    isUnderage: false,
    isMultiplayerGamingRestricted: false,
    isPersonalizedCommunicationRestricted: false,
  },
});

const proof = (teamPlayerId: string): GameCenterIdentityVerificationItems => ({
  teamPlayerId,
  gamePlayerId: `game-${teamPlayerId}`,
  alias: `Alias ${teamPlayerId}`,
  bundleId: 'app.fortuneness.test',
  publicKeyUrl: 'https://static.gc.apple.com/key.cer',
  signatureBase64: Buffer.from('signature').toString('base64'),
  saltBase64: Buffer.from('salt').toString('base64'),
  timestamp: '1786000000000',
  scopedIdsPersistent: true,
  restrictions: {
    isUnderage: false,
    isMultiplayerGamingRestricted: false,
    isPersonalizedCommunicationRestricted: false,
  },
});

function account(userId: string, marker: string): MeResponse {
  return {
    user: {
      id: userId,
      status: 'ACTIVE',
      resolvedLocale: 'en',
      accountTimeZone: 'Europe/Kyiv',
      pendingTimeZone: null,
      timeZoneEffectiveAt: null,
      nextTimeZoneChangeEligibleAt: null,
      onboardingCompletedAt: null,
      preferences: {
        reminderEnabled: false,
        reminderLocalMinutes: 540,
        soundEnabled: true,
        hapticsEnabled: true,
        reduceMotionPreferred: false,
      },
    },
    bootstrap: {
      serverTime: '2026-08-06T10:00:00.000Z',
      reportedDeviceLocale: 'en-US',
      reportedDeviceTimeZone: 'Europe/Kyiv',
      appAccountToken: marker,
    },
  };
}

function tokens(marker: string): RefreshSessionResponse {
  return {
    session: {
      accessToken: `access-${marker}`.padEnd(32, 'a'),
      refreshToken: `refresh-${marker}`.padEnd(32, 'r'),
      accessTokenExpiresAt: '2099-08-06T10:15:00.000Z',
      refreshTokenExpiresAt: '2099-09-05T10:00:00.000Z',
      authTime: '2026-08-06T10:00:00.000Z',
    },
  };
}

function loginResponse(userId: string, marker: string): GameCenterAuthResponse {
  return { ...account(userId, marker), ...tokens(marker) };
}

function createFixture(
  options: {
    authenticateFailure?: MobileApiError;
    bootstrapFailure?: MobileApiError;
    initialStored?: StoredCredentials;
    refreshFailure?: MobileApiError;
  } = {},
) {
  let stored = options.initialStored;
  let proofPlayerId = 'player-one';
  const authenticate = vi.fn<(request: GameCenterAuthRequest) => Promise<GameCenterAuthResponse>>(
    (request) => {
      if (options.authenticateFailure !== undefined) {
        return Promise.reject(options.authenticateFailure);
      }
      const userId =
        request.proof.teamPlayerId === 'player-one'
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222';
      return Promise.resolve(
        loginResponse(userId, request.proof.teamPlayerId === 'player-one' ? 'one' : 'two'),
      );
    },
  );
  const refresh =
    options.refreshFailure === undefined
      ? vi.fn().mockResolvedValue(tokens('restored'))
      : vi.fn().mockRejectedValue(options.refreshFailure);
  const bootstrap =
    options.bootstrapFailure === undefined
      ? vi
          .fn()
          .mockResolvedValue(
            account(stored?.userId ?? '11111111-1111-4111-8111-111111111111', 'stored'),
          )
      : vi.fn().mockRejectedValue(options.bootstrapFailure);
  const save = vi.fn<(credentials: StoredCredentials) => Promise<void>>((credentials) => {
    stored = credentials;
    return Promise.resolve();
  });
  const clearAccountData = vi.fn(() => {
    stored = undefined;
    return Promise.resolve();
  });
  const dependencies: AuthenticationCoordinatorDependencies = {
    api: {
      authenticate,
      bootstrap,
      logout: vi.fn().mockResolvedValue(undefined),
      refresh,
    },
    clearAccountData,
    createUuid: () => '33333333-3333-4333-8333-333333333333',
    deviceContext: () => ({ locale: 'en-US', timeZone: 'Europe/Kyiv' }),
    fingerprint: (teamPlayerId) => Promise.resolve(`fingerprint:${teamPlayerId}`),
    native: {
      fetchProof: () => Promise.resolve(proof(proofPlayerId)),
      start: () => Promise.resolve(playerState(proofPlayerId)),
      subscribe: () => ({ remove: () => undefined }),
    },
    storage: {
      getDeviceId: () => Promise.resolve('44444444-4444-4444-8444-444444444444'),
      load: () => Promise.resolve(stored),
      save,
    },
  };
  return {
    authenticate,
    bootstrap,
    clearAccountData,
    coordinator: new AuthenticationCoordinator(dependencies),
    refresh,
    save,
    setProofPlayer: (teamPlayerId: string) => {
      proofPlayerId = teamPlayerId;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthenticationCoordinator', () => {
  it('exchanges a persistent proof and stores only account credentials plus a local fingerprint', async () => {
    const fixture = createFixture();
    await fixture.coordinator.handleNativeState(playerState('player-one'));

    expect(fixture.coordinator.state).toMatchObject({
      phase: 'AUTHENTICATED',
      session: { alias: 'Alias player-one', playerFingerprint: 'fingerprint:player-one' },
    });
    expect(fixture.authenticate).toHaveBeenCalledOnce();
    expect(fixture.save).toHaveBeenCalledWith({
      appAccountToken: 'one',
      playerFingerprint: 'fingerprint:player-one',
      refreshToken: expect.any(String),
      userId: '11111111-1111-4111-8111-111111111111',
    });
    fixture.coordinator.stop();
  });

  it('restores only after the current Game Center fingerprint matches', async () => {
    const fixture = createFixture({
      initialStored: {
        appAccountToken: '55555555-5555-4555-8555-555555555555',
        playerFingerprint: 'fingerprint:player-one',
        refreshToken: 'stored-refresh-token'.padEnd(32, 'r'),
        userId: '11111111-1111-4111-8111-111111111111',
      },
    });
    await fixture.coordinator.handleNativeState(playerState('player-one'));

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.bootstrap).toHaveBeenCalledOnce();
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(fixture.coordinator.state.phase).toBe('AUTHENTICATED');
    fixture.coordinator.stop();
  });

  it('clears a rejected stored refresh before falling back to a fresh proof', async () => {
    const fixture = createFixture({
      initialStored: {
        appAccountToken: '55555555-5555-4555-8555-555555555555',
        playerFingerprint: 'fingerprint:player-one',
        refreshToken: 'stored-refresh-token'.padEnd(32, 'r'),
        userId: '11111111-1111-4111-8111-111111111111',
      },
      refreshFailure: new MobileApiError({
        code: 'AUTH_REQUIRED',
        message: 'invalid',
        retryable: false,
        statusCode: 401,
      }),
    });
    await fixture.coordinator.handleNativeState(playerState('player-one'));

    expect(fixture.clearAccountData).toHaveBeenCalledOnce();
    expect(fixture.authenticate).toHaveBeenCalledOnce();
    expect(fixture.coordinator.state.phase).toBe('AUTHENTICATED');
    fixture.coordinator.stop();
  });

  it('retains the rotated refresh token when bootstrap is temporarily offline', async () => {
    const fixture = createFixture({
      bootstrapFailure: new MobileApiError({
        code: 'NETWORK_UNAVAILABLE',
        message: 'offline',
        retryable: true,
      }),
      initialStored: {
        appAccountToken: '55555555-5555-4555-8555-555555555555',
        playerFingerprint: 'fingerprint:player-one',
        refreshToken: 'stored-refresh-token'.padEnd(32, 'r'),
        userId: '11111111-1111-4111-8111-111111111111',
      },
    });
    await fixture.coordinator.handleNativeState(playerState('player-one'));

    expect(fixture.save).toHaveBeenCalledWith({
      appAccountToken: '55555555-5555-4555-8555-555555555555',
      playerFingerprint: 'fingerprint:player-one',
      refreshToken: tokens('restored').session.refreshToken,
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(fixture.clearAccountData).not.toHaveBeenCalled();
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(fixture.coordinator.state.phase).toBe('ERROR');
    fixture.coordinator.stop();
  });

  it('clears the first account before establishing a switched player', async () => {
    const fixture = createFixture();
    await fixture.coordinator.handleNativeState(playerState('player-one'));
    fixture.setProofPlayer('player-two');
    await fixture.coordinator.handleNativeState(playerState('player-two'));

    expect(fixture.clearAccountData).toHaveBeenCalled();
    expect(fixture.coordinator.state).toMatchObject({
      phase: 'AUTHENTICATED',
      session: {
        playerFingerprint: 'fingerprint:player-two',
        user: { id: '22222222-2222-4222-8222-222222222222' },
      },
    });
    fixture.coordinator.stop();
  });

  it('keeps a disconnected player blocked until retry or a player change', async () => {
    const fixture = createFixture();
    await fixture.coordinator.handleNativeState(playerState('player-one'));
    await fixture.coordinator.disconnect();
    await fixture.coordinator.handleNativeState(playerState('player-one'));
    expect(fixture.coordinator.state.phase).toBe('GAME_CENTER_BLOCKED');

    fixture.setProofPlayer('player-two');
    await fixture.coordinator.handleNativeState(playerState('player-two'));
    expect(fixture.coordinator.state.phase).toBe('AUTHENTICATED');
    fixture.coordinator.stop();
  });

  it('renders deletion pending without retaining local credentials', async () => {
    const fixture = createFixture({
      authenticateFailure: new MobileApiError({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'pending',
        retryable: false,
        statusCode: 423,
      }),
    });
    await fixture.coordinator.handleNativeState(playerState('player-one'));

    expect(fixture.coordinator.state.phase).toBe('DELETION_PENDING');
    expect(fixture.clearAccountData).toHaveBeenCalled();
    fixture.coordinator.stop();
  });
});
