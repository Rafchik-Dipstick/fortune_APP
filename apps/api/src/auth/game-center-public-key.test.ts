import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { CachedGameCenterPublicKeyProvider } from './game-center-public-key.js';

const environment = createTestApiEnvironment().authentication;

describe('CachedGameCenterPublicKeyProvider', () => {
  it('deduplicates concurrent loads and respects bounded cache age', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2_048 });
    const fetchCertificate = vi.fn().mockResolvedValue({
      bytes: Buffer.from('certificate'),
      cacheMaxAgeSeconds: 300,
    });
    const validateCertificate = vi.fn().mockResolvedValue({
      publicKey,
      expiresAt: new Date('2026-08-06T11:00:00.000Z'),
    });
    const provider = new CachedGameCenterPublicKeyProvider(environment, {
      fetchCertificate,
      validateCertificate,
    });
    const url = 'https://static.gc.apple.com/public-key/gc-test.cer';
    const now = new Date('2026-08-06T10:00:00.000Z');

    const [first, second] = await Promise.all([
      provider.getPublicKey(url, now),
      provider.getPublicKey(url, now),
    ]);
    const cached = await provider.getPublicKey(url, new Date(now.getTime() + 299_000));

    expect(first).toBe(publicKey);
    expect(second).toBe(publicKey);
    expect(cached).toBe(publicKey);
    expect(fetchCertificate).toHaveBeenCalledOnce();

    await provider.getPublicKey(url, new Date(now.getTime() + 301_000));
    expect(fetchCertificate).toHaveBeenCalledTimes(2);
  });

  it('rejects an unapproved host without fetching', async () => {
    const fetchCertificate = vi.fn();
    const provider = new CachedGameCenterPublicKeyProvider(environment, { fetchCertificate });

    await expect(provider.getPublicKey('https://localhost/key.cer', new Date())).rejects.toThrow();
    expect(fetchCertificate).not.toHaveBeenCalled();
  });
});
