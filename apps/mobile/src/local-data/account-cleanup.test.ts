import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  clearStoredCredentials: vi.fn<() => Promise<void>>(),
  loadStoredCredentials: vi.fn(),
}));

vi.mock('../auth/session-storage', () => storage);

import { clearAllLocalAccountData, registerAccountDataClearer } from './account-cleanup';

const unregisterClearers: (() => void)[] = [];

afterEach(() => {
  while (unregisterClearers.length > 0) {
    unregisterClearers.pop()?.();
  }
  vi.resetAllMocks();
});

describe('clearAllLocalAccountData', () => {
  it('clears credentials and the matching account partition', async () => {
    storage.loadStoredCredentials.mockResolvedValue({ userId: 'user-a' });
    storage.clearStoredCredentials.mockResolvedValue(undefined);
    const clearAccount = vi.fn().mockResolvedValue(undefined);
    unregisterClearers.push(registerAccountDataClearer(clearAccount));

    await clearAllLocalAccountData();

    expect(storage.clearStoredCredentials).toHaveBeenCalledOnce();
    expect(clearAccount).toHaveBeenCalledWith('user-a');
  });

  it('still clears the runtime cache when credential storage fails', async () => {
    const storageFailure = new Error('secure storage unavailable');
    storage.loadStoredCredentials.mockRejectedValue(storageFailure);
    storage.clearStoredCredentials.mockResolvedValue(undefined);
    const clearAccount = vi.fn().mockResolvedValue(undefined);
    unregisterClearers.push(registerAccountDataClearer(clearAccount));

    await expect(clearAllLocalAccountData()).rejects.toBe(storageFailure);

    expect(storage.clearStoredCredentials).toHaveBeenCalledOnce();
    expect(clearAccount).toHaveBeenCalledWith(undefined);
  });
});
