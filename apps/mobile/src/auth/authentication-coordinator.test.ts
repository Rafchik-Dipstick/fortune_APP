import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AppleAuthRequest,
  AppleAuthResponse,
  MeResponse,
  RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import {
  AuthenticationCoordinator,
  type AuthenticationCoordinatorDependencies,
} from './authentication-coordinator';
import { MobileApiError } from './api-client';
import type { StoredCredentials } from './session-storage';

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
      serverTime: '2026-08-08T10:00:00.000Z',
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
      accessTokenExpiresAt: '2099-08-08T10:15:00.000Z',
      refreshTokenExpiresAt: '2099-09-07T10:00:00.000Z',
      authTime: '2026-08-08T10:00:00.000Z',
    },
  };
}

function loginResponse(userId: string, marker: string): AppleAuthResponse {
  return { ...account(userId, marker), ...tokens(marker) };
}

const storedCredentials = (): StoredCredentials => ({
  appAccountToken: '55555555-5555-4555-8555-555555555555',
  identityFingerprint: 'fingerprint:apple-user-one',
  refreshToken: 'stored-refresh-token'.padEnd(32, 'r'),
  userId: '11111111-1111-4111-8111-111111111111',
});

function createFixture(
  options: {
    authenticateFailure?: MobileApiError;
    bootstrapFailure?: MobileApiError;
    initialStored?: StoredCredentials;
    refreshFailure?: MobileApiError;
  } = {},
) {
  let stored = options.initialStored;
  let appleUser = 'apple-user-one';
  const authenticate = vi.fn<(request: AppleAuthRequest) => Promise<AppleAuthResponse>>(() => {
    if (options.authenticateFailure !== undefined) {
      return Promise.reject(options.authenticateFailure);
    }
    const userId =
      appleUser === 'apple-user-one'
        ? '11111111-1111-4111-8111-111111111111'
        : '22222222-2222-4222-8222-222222222222';
    return Promise.resolve(loginResponse(userId, appleUser));
  });
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
  const signIn = vi.fn(() =>
    Promise.resolve({
      identityToken: 'headerpayload.headerpayload.signaturepart',
      user: appleUser,
    }),
  );
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
    fingerprint: (user) => Promise.resolve(`fingerprint:${user}`),
    native: {
      isAvailable: () => Promise.resolve(true),
      signIn,
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
    setAppleUser: (user: string) => {
      appleUser = user;
    },
    signIn,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthenticationCoordinator', () => {
  it('starts at an Apple sign-in gate without presenting the system sheet', async () => {
    const fixture = createFixture();

    await fixture.coordinator.start();

    expect(fixture.coordinator.state.phase).toBe('APPLE_SIGN_IN_REQUIRED');
    expect(fixture.signIn).not.toHaveBeenCalled();
    fixture.coordinator.stop();
  });

  it('exchanges an Apple identity token only after the user chooses sign in', async () => {
    const fixture = createFixture();
    await fixture.coordinator.start();
    await fixture.coordinator.retry();

    expect(fixture.authenticate).toHaveBeenCalledWith({
      identityToken: 'headerpayload.headerpayload.signaturepart',
      nonce: '33333333-3333-4333-8333-333333333333',
      reportedDeviceLocale: 'en-US',
      reportedDeviceTimeZone: 'Europe/Kyiv',
      device: { id: '44444444-4444-4444-8444-444444444444' },
    });
    expect(fixture.coordinator.state).toMatchObject({
      phase: 'AUTHENTICATED',
      session: {
        accountLabel: 'Apple Account',
        identityFingerprint: 'fingerprint:apple-user-one',
      },
    });
    expect(fixture.save).toHaveBeenCalledWith({
      appAccountToken: 'apple-user-one',
      identityFingerprint: 'fingerprint:apple-user-one',
      refreshIdempotencyKey: expect.any(String),
      refreshToken: expect.any(String),
      userId: '11111111-1111-4111-8111-111111111111',
    });
    fixture.coordinator.stop();
  });

  it('restores a rotating Fortuneness session without presenting Apple sign-in', async () => {
    const fixture = createFixture({ initialStored: storedCredentials() });

    await fixture.coordinator.start();

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.bootstrap).toHaveBeenCalledOnce();
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(fixture.signIn).not.toHaveBeenCalled();
    expect(fixture.coordinator.state.phase).toBe('AUTHENTICATED');
    fixture.coordinator.stop();
  });

  it('clears an invalid refresh session and returns to the Apple sign-in gate', async () => {
    const fixture = createFixture({
      initialStored: storedCredentials(),
      refreshFailure: new MobileApiError({
        code: 'AUTH_REQUIRED',
        message: 'invalid',
        retryable: false,
        statusCode: 401,
      }),
    });

    await fixture.coordinator.start();

    expect(fixture.clearAccountData).toHaveBeenCalledOnce();
    expect(fixture.signIn).not.toHaveBeenCalled();
    expect(fixture.coordinator.state.phase).toBe('APPLE_SIGN_IN_REQUIRED');
    fixture.coordinator.stop();
  });

  it('keeps stored account data through a transient refresh failure', async () => {
    const fixture = createFixture({
      initialStored: storedCredentials(),
      refreshFailure: new MobileApiError({
        code: 'RETRYABLE_CONFLICT',
        message: 'transient',
        retryable: true,
        statusCode: 503,
      }),
    });

    await fixture.coordinator.start();

    expect(fixture.clearAccountData).not.toHaveBeenCalled();
    expect(fixture.coordinator.state.phase).toBe('ERROR');
    fixture.coordinator.stop();
  });

  it('keeps the Apple identity in memory through deletion management and cancellation', async () => {
    const fixture = createFixture({
      authenticateFailure: new MobileApiError({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'pending',
        retryable: false,
        statusCode: 423,
      }),
    });
    await fixture.coordinator.retry();
    expect(fixture.coordinator.state.phase).toBe('DELETION_PENDING');

    await fixture.coordinator.resumeAfterDeletionCancelled(
      loginResponse('11111111-1111-4111-8111-111111111111', 'restored'),
    );

    expect(fixture.coordinator.state).toMatchObject({
      phase: 'AUTHENTICATED',
      session: { identityFingerprint: 'fingerprint:apple-user-one' },
    });
    fixture.coordinator.stop();
  });

  it('rejects sensitive reauthentication with a different Apple Account', async () => {
    const fixture = createFixture();
    await fixture.coordinator.retry();
    fixture.setAppleUser('apple-user-two');

    await expect(fixture.coordinator.reauthenticate()).resolves.toBe(false);
    expect(fixture.coordinator.state).toMatchObject({
      phase: 'AUTHENTICATED',
      session: { identityFingerprint: 'fingerprint:apple-user-one' },
    });
    fixture.coordinator.stop();
  });

  it('reuses the stored idempotency key for a retry of the same refresh token', async () => {
    const storedKey = '66666666-6666-4666-8666-666666666666';
    const fixture = createFixture({
      initialStored: { ...storedCredentials(), refreshIdempotencyKey: storedKey },
      refreshFailure: new MobileApiError({
        code: 'RETRYABLE_CONFLICT',
        message: 'transient',
        retryable: true,
      }),
    });

    await fixture.coordinator.start();
    await fixture.coordinator.retry();

    for (const call of fixture.refresh.mock.calls) {
      expect(call[2]).toBe(storedKey);
    }
    expect(fixture.refresh.mock.calls.length).toBe(2);
    fixture.coordinator.stop();
  });
});
