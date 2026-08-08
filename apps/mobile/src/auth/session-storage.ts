import * as SecureStore from 'expo-secure-store';

const storageKeys = {
  appAccountToken: 'fortuneness.session.app-account-token',
  deviceId: 'fortuneness.installation.device-id',
  identityFingerprint: 'fortuneness.session.apple-identity-fingerprint',
  legacyGameCenterFingerprint: 'fortuneness.session.game-center-fingerprint',
  refreshIdempotencyKey: 'fortuneness.session.refresh-idempotency-key',
  refreshToken: 'fortuneness.session.refresh-token',
  userId: 'fortuneness.session.user-id',
} as const;

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface StoredCredentials {
  appAccountToken: string;
  identityFingerprint: string;
  /**
   * The idempotency key belonging to `refreshToken`. It is minted once per
   * rotation and reused by every attempt to spend that token: the server
   * replays its stored receipt for a repeated key, but treats a *fresh* key on
   * an already-consumed token as reuse and revokes the whole session family.
   * A new key per attempt therefore turned one lost response into a forced
   * sign-out. Absent on installs from before this key existed.
   */
  refreshIdempotencyKey?: string;
  refreshToken: string;
  userId: string;
}

export async function getOrCreateDeviceId(createUuid: () => string): Promise<string> {
  const existing = await SecureStore.getItemAsync(storageKeys.deviceId, secureOptions);
  if (existing !== null) {
    return existing;
  }
  const created = createUuid();
  await SecureStore.setItemAsync(storageKeys.deviceId, created, secureOptions);
  return created;
}

export async function loadStoredCredentials(): Promise<StoredCredentials | undefined> {
  const [appAccountToken, identityFingerprint, refreshIdempotencyKey, refreshToken, userId] =
    await Promise.all([
      SecureStore.getItemAsync(storageKeys.appAccountToken, secureOptions),
      SecureStore.getItemAsync(storageKeys.identityFingerprint, secureOptions),
      SecureStore.getItemAsync(storageKeys.refreshIdempotencyKey, secureOptions),
      SecureStore.getItemAsync(storageKeys.refreshToken, secureOptions),
      SecureStore.getItemAsync(storageKeys.userId, secureOptions),
    ]);
  if (
    appAccountToken === null ||
    identityFingerprint === null ||
    refreshToken === null ||
    userId === null
  ) {
    await clearStoredCredentials();
    return undefined;
  }
  // The refresh key is deliberately not required: an install that predates it
  // still has a usable session, and one is minted on its next rotation.
  return {
    appAccountToken,
    identityFingerprint,
    ...(refreshIdempotencyKey === null ? {} : { refreshIdempotencyKey }),
    refreshToken,
    userId,
  };
}

export async function saveStoredCredentials(credentials: StoredCredentials): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(
        storageKeys.appAccountToken,
        credentials.appAccountToken,
        secureOptions,
      ),
      SecureStore.setItemAsync(
        storageKeys.identityFingerprint,
        credentials.identityFingerprint,
        secureOptions,
      ),
      credentials.refreshIdempotencyKey === undefined
        ? SecureStore.deleteItemAsync(storageKeys.refreshIdempotencyKey, secureOptions)
        : SecureStore.setItemAsync(
            storageKeys.refreshIdempotencyKey,
            credentials.refreshIdempotencyKey,
            secureOptions,
          ),
      SecureStore.setItemAsync(storageKeys.refreshToken, credentials.refreshToken, secureOptions),
      SecureStore.setItemAsync(storageKeys.userId, credentials.userId, secureOptions),
    ]);
  } catch (error) {
    await clearStoredCredentials();
    throw error;
  }
}

export async function clearStoredCredentials(): Promise<void> {
  await Promise.all(
    [
      storageKeys.appAccountToken,
      storageKeys.identityFingerprint,
      storageKeys.legacyGameCenterFingerprint,
      storageKeys.refreshIdempotencyKey,
      storageKeys.refreshToken,
      storageKeys.userId,
    ].map((key) => SecureStore.deleteItemAsync(key, secureOptions)),
  );
}
