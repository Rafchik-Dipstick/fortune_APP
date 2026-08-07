import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { type VersionedKeyRing } from '../config/environment.js';
import { encryptBytes } from '../security/crypto.js';
import {
  PurchaseTokenKeyMismatchError,
  verifyPurchaseTokenEncryptionKeys,
} from './purchase-token-preflight.js';
import { tokenEncryptionContext } from './purchase-token.js';

const financialSubjectId = '5801a4df-dfcc-4c4d-994f-75eea3cddef7';

function createKeyRing(keys: Record<string, Buffer>, currentVersion = 'v1'): VersionedKeyRing {
  return { currentVersion, keys };
}

function createBinding(keyVersion: string, keyRing: VersionedKeyRing) {
  const encrypted = encryptBytes(
    Buffer.from('7c9e6679-7425-40de-944b-e07fc1f90ae7', 'utf8'),
    { ...keyRing, currentVersion: keyVersion },
    tokenEncryptionContext(financialSubjectId),
  );
  return {
    encryptedToken: new Uint8Array(encrypted.encrypted),
    financialSubjectId,
  };
}

function createReader(binding: unknown) {
  return { findFirst: vi.fn().mockResolvedValue(binding) } as never;
}

describe('verifyPurchaseTokenEncryptionKeys', () => {
  it('verifies a version whose stored ciphertext still opens', async () => {
    const keyRing = createKeyRing({ v1: randomBytes(32) });

    const outcome = await verifyPurchaseTokenEncryptionKeys(
      createReader(createBinding('v1', keyRing)),
      keyRing,
    );

    expect(outcome).toEqual({ checkedVersions: ['v1'], status: 'verified' });
  });

  it('refuses a version present under different key material', async () => {
    const written = createKeyRing({ v1: randomBytes(32) });
    const configured = createKeyRing({ v1: randomBytes(32) });

    await expect(
      verifyPurchaseTokenEncryptionKeys(createReader(createBinding('v1', written)), configured),
    ).rejects.toThrow(PurchaseTokenKeyMismatchError);
  });

  it('passes when no binding has been written yet', async () => {
    const outcome = await verifyPurchaseTokenEncryptionKeys(
      createReader(null),
      createKeyRing({ v1: randomBytes(32) }),
    );

    expect(outcome).toEqual({ checkedVersions: [], status: 'verified' });
  });

  it('only samples open bindings, whose ciphertext is the only kind ever reopened', async () => {
    const keyRing = createKeyRing({ v1: randomBytes(32) });
    const findFirst = vi.fn().mockResolvedValue(null);

    await verifyPurchaseTokenEncryptionKeys({ findFirst } as never, keyRing);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ validTo: null }) }),
    );
  });

  it('skips rather than refusing to boot when the database cannot be read', async () => {
    const bindings = {
      findFirst: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as never;

    const outcome = await verifyPurchaseTokenEncryptionKeys(
      bindings,
      createKeyRing({ v1: randomBytes(32) }),
    );

    expect(outcome).toEqual({ status: 'skipped' });
  });

  it('checks every configured version, not only the current one', async () => {
    const keyRing = createKeyRing({ v1: randomBytes(32), v2: randomBytes(32) }, 'v2');
    const bindings = {
      findFirst: vi
        .fn()
        .mockImplementation(({ where }: { where: { encryptionKeyVersion: string } }) =>
          Promise.resolve(createBinding(where.encryptionKeyVersion, keyRing)),
        ),
    } as never;

    const outcome = await verifyPurchaseTokenEncryptionKeys(bindings, keyRing);

    expect(outcome).toEqual({ checkedVersions: ['v1', 'v2'], status: 'verified' });
  });
});
