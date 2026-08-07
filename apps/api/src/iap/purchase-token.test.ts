import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { type VersionedKeyRing } from '../config/environment.js';
import { encryptBytes } from '../security/crypto.js';
import {
  resolveCurrentPurchaseToken,
  tokenEncryptionContext,
  type PurchaseTokenKeys,
} from './purchase-token.js';

const financialSubjectId = '5801a4df-dfcc-4c4d-994f-75eea3cddef7';
const storedToken = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const mintedToken = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const now = new Date('2026-08-07T13:49:28.808Z');

function createKeyRing(keys: Record<string, Buffer>, currentVersion: string): VersionedKeyRing {
  return { currentVersion, keys };
}

function createKeys(encryptionKeys: VersionedKeyRing): PurchaseTokenKeys {
  return { encryptionKeys, hmacKeys: createKeyRing({ v1: randomBytes(32) }, 'v1') };
}

function createBinding(writtenWith: VersionedKeyRing, keyVersion: string) {
  const encrypted = encryptBytes(
    Buffer.from(storedToken, 'utf8'),
    { ...writtenWith, currentVersion: keyVersion },
    tokenEncryptionContext(financialSubjectId),
  );
  return {
    id: 'binding-1',
    encryptedToken: new Uint8Array(encrypted.encrypted),
    encryptionKeyVersion: keyVersion,
  };
}

function createTransaction(current: unknown) {
  const appAccountTokenBinding = {
    findFirst: vi.fn().mockResolvedValue(current),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({ id: 'binding-2' }),
  };
  return { transaction: { appAccountTokenBinding } as never, appAccountTokenBinding };
}

describe('resolveCurrentPurchaseToken', () => {
  it('returns the stored token when its key version still resolves', async () => {
    const ring = createKeyRing({ v1: randomBytes(32) }, 'v1');
    const { transaction, appAccountTokenBinding } = createTransaction(createBinding(ring, 'v1'));

    const resolved = await resolveCurrentPurchaseToken(
      transaction,
      financialSubjectId,
      createKeys(ring),
      now,
      () => mintedToken,
    );

    expect(resolved).toEqual({ bindingId: 'binding-1', token: storedToken });
    expect(appAccountTokenBinding.create).not.toHaveBeenCalled();
  });

  it('rotates instead of throwing when the key version has been retired', async () => {
    const retired = createKeyRing({ v1: randomBytes(32) }, 'v1');
    const configured = createKeyRing({ v2: randomBytes(32) }, 'v2');
    const { transaction, appAccountTokenBinding } = createTransaction(createBinding(retired, 'v1'));

    const resolved = await resolveCurrentPurchaseToken(
      transaction,
      financialSubjectId,
      createKeys(configured),
      now,
      () => mintedToken,
    );

    expect(resolved).toEqual({ bindingId: 'binding-2', token: mintedToken });
    expect(appAccountTokenBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding-1' },
      data: { validTo: now },
    });
    expect(appAccountTokenBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'ROTATION', rotatedFromBindingId: 'binding-1' }),
      }),
    );
  });

  it('fails loudly when the version resolves to different key material', async () => {
    const written = createKeyRing({ v1: randomBytes(32) }, 'v1');
    const configured = createKeyRing({ v1: randomBytes(32) }, 'v1');
    const { transaction, appAccountTokenBinding } = createTransaction(createBinding(written, 'v1'));

    await expect(
      resolveCurrentPurchaseToken(
        transaction,
        financialSubjectId,
        createKeys(configured),
        now,
        () => mintedToken,
      ),
    ).rejects.toThrow();
    // Rotating here would mint a fresh appAccountToken for a player Apple still
    // reports transactions for under the old one.
    expect(appAccountTokenBinding.create).not.toHaveBeenCalled();
  });

  it('mints an initial binding when the subject has none', async () => {
    const ring = createKeyRing({ v1: randomBytes(32) }, 'v1');
    const { transaction, appAccountTokenBinding } = createTransaction(null);

    const resolved = await resolveCurrentPurchaseToken(
      transaction,
      financialSubjectId,
      createKeys(ring),
      now,
      () => mintedToken,
    );

    expect(resolved).toEqual({ bindingId: 'binding-2', token: mintedToken });
    expect(appAccountTokenBinding.update).not.toHaveBeenCalled();
    expect(appAccountTokenBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'INITIAL', rotatedFromBindingId: null }),
      }),
    );
  });
});
