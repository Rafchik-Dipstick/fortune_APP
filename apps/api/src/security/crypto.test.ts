import { describe, expect, it } from 'vitest';

import { type VersionedKeyRing } from '../config/environment.js';
import {
  constantTimeEqual,
  createCurrentHmacDigest,
  createHmacDigestCandidates,
  createOpaqueToken,
  decryptBytes,
  encryptBytes,
} from './crypto.js';

const keyRing: VersionedKeyRing = {
  currentVersion: 'v2',
  keys: {
    v1: Buffer.alloc(32, 1),
    v2: Buffer.alloc(32, 2),
  },
};

describe('versioned cryptography', () => {
  it('writes with the current HMAC key and reads current plus previous candidates', () => {
    const current = createCurrentHmacDigest('player-id', keyRing);
    const candidates = createHmacDigestCandidates('player-id', keyRing);

    expect(current.keyVersion).toBe('v2');
    expect(current.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(candidates.map(({ keyVersion }) => keyVersion)).toEqual(['v2', 'v1']);
    expect(new Set(candidates.map(({ digest }) => digest)).size).toBe(2);
  });

  it('decrypts old-key ciphertext after rotation and authenticates its context', () => {
    const previousKeyRing: VersionedKeyRing = { ...keyRing, currentVersion: 'v1' };
    const encrypted = encryptBytes(Buffer.from('replacement-token'), previousKeyRing, 'receipt:1');

    expect(decryptBytes(encrypted.encrypted, encrypted.keyVersion, keyRing, 'receipt:1')).toEqual(
      Buffer.from('replacement-token'),
    );
    expect(() =>
      decryptBytes(encrypted.encrypted, encrypted.keyVersion, keyRing, 'receipt:2'),
    ).toThrow();
  });

  it('creates high-entropy URL-safe opaque tokens and compares fixed bytes safely', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(constantTimeEqual(Buffer.from('same'), Buffer.from('same'))).toBe(true);
    expect(constantTimeEqual(Buffer.from('same'), Buffer.from('different'))).toBe(false);
  });
});
