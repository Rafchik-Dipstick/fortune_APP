import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { type VersionedKeyRing } from '../config/environment.js';

const nonceLength = 12;
const authenticationTagLength = 16;

export interface VersionedCiphertext {
  encrypted: Buffer;
  keyVersion: string;
}

function getCurrentKey(keyRing: VersionedKeyRing): Buffer {
  const key = keyRing.keys[keyRing.currentVersion];
  if (key === undefined) {
    throw new Error('Current cryptographic key is unavailable.');
  }
  return key;
}

export function createHmacDigest(value: string | Buffer, key: Buffer): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function createCurrentHmacDigest(
  value: string | Buffer,
  keyRing: VersionedKeyRing,
): { digest: string; keyVersion: string } {
  return {
    digest: createHmacDigest(value, getCurrentKey(keyRing)),
    keyVersion: keyRing.currentVersion,
  };
}

export function createHmacDigestCandidates(
  value: string | Buffer,
  keyRing: VersionedKeyRing,
): readonly { digest: string; keyVersion: string }[] {
  const current = createCurrentHmacDigest(value, keyRing);
  return [
    current,
    ...Object.entries(keyRing.keys)
      .filter(([version]) => version !== keyRing.currentVersion)
      .map(([keyVersion, key]) => ({ keyVersion, digest: createHmacDigest(value, key) })),
  ];
}

export function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function encryptBytes(
  plaintext: Buffer,
  keyRing: VersionedKeyRing,
  authenticatedContext: string,
): VersionedCiphertext {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv('aes-256-gcm', getCurrentKey(keyRing), nonce, {
    authTagLength: authenticationTagLength,
  });
  cipher.setAAD(Buffer.from(authenticatedContext, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return {
    keyVersion: keyRing.currentVersion,
    encrypted: Buffer.concat([nonce, authenticationTag, ciphertext]),
  };
}

export function decryptBytes(
  encrypted: Buffer,
  keyVersion: string,
  keyRing: VersionedKeyRing,
  authenticatedContext: string,
): Buffer {
  const key = keyRing.keys[keyVersion];
  if (key === undefined) {
    throw new Error('Ciphertext key version is unavailable.');
  }
  if (encrypted.length < nonceLength + authenticationTagLength + 1) {
    throw new Error('Ciphertext envelope is malformed.');
  }

  const nonce = encrypted.subarray(0, nonceLength);
  const authenticationTag = encrypted.subarray(nonceLength, nonceLength + authenticationTagLength);
  const ciphertext = encrypted.subarray(nonceLength + authenticationTagLength);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
    authTagLength: authenticationTagLength,
  });
  decipher.setAAD(Buffer.from(authenticatedContext, 'utf8'));
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
