import { randomUUID } from 'node:crypto';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { type Prisma } from '../generated/prisma/client.js';
import {
  createCurrentHmacDigest,
  createHmacDigestCandidates,
  decryptBytes,
  encryptBytes,
  resolveVersionedKey,
} from '../security/crypto.js';

export interface PurchaseTokenKeys {
  encryptionKeys: AuthenticationEnvironment['appAccountTokenEncryptionKeys'];
  hmacKeys: AuthenticationEnvironment['appAccountTokenHmacKeys'];
}

export interface CurrentPurchaseToken {
  bindingId: string;
  token: string;
}

export interface ResolvedTokenBinding {
  bindingId: string;
  financialSubjectId: string;
  validFrom: Date;
  validTo: Date | null;
}

export const tokenEncryptionContext = (financialSubjectId: string): string =>
  `app-account-token:${financialSubjectId}`;

function normalizeToken(rawToken: string): string {
  return rawToken.trim().toLowerCase();
}

/**
 * Returns the raw purchase token for the caller's financial subject, minting
 * the initial binding when none exists. The raw UUID is only ever stored
 * encrypted; lookups use the versioned HMAC digest. Must run inside the
 * financial-subject lock.
 */
export async function resolveCurrentPurchaseToken(
  transaction: Prisma.TransactionClient,
  financialSubjectId: string,
  keys: PurchaseTokenKeys,
  now: Date,
  uuidFactory: () => string = randomUUID,
): Promise<CurrentPurchaseToken> {
  const current = await transaction.appAccountTokenBinding.findFirst({
    where: { financialSubjectId, validTo: null },
    orderBy: { validFrom: 'desc' },
  });

  if (current?.encryptedToken != null && current.encryptionKeyVersion !== null) {
    // A retired key version is a recoverability question, not an error: the
    // ciphertext is simply no longer openable, so the binding falls through to
    // the rotation below. Asking before decrypting is what makes that reachable
    // -- `decryptBytes` throws on an absent version, which turned the very case
    // the rotation comment names into a 500 on every catalog request.
    if (resolveVersionedKey(keys.encryptionKeys, current.encryptionKeyVersion) !== undefined) {
      // Reaching here with a decryption failure means the ring holds this
      // version under different key material, so the ciphertext was written by
      // another deployment. That is a misconfiguration rather than a
      // retirement, and it must stay loud: rotating instead would mint a new
      // appAccountToken for every player and silently break reconciliation of
      // the transactions Apple still reports under the old one.
      const token = decryptBytes(
        Buffer.from(current.encryptedToken),
        current.encryptionKeyVersion,
        keys.encryptionKeys,
        tokenEncryptionContext(financialSubjectId),
      ).toString('utf8');
      return { bindingId: current.id, token };
    }
  }

  // A current binding without a recoverable raw value (for example after an
  // encryption-key retirement) is closed and rotated to a fresh token so the
  // client always purchases with a resolvable identity.
  if (current !== null) {
    await transaction.appAccountTokenBinding.update({
      where: { id: current.id },
      data: { validTo: now },
    });
  }

  const token = normalizeToken(uuidFactory());
  const digest = createCurrentHmacDigest(token, keys.hmacKeys);
  const encrypted = encryptBytes(
    Buffer.from(token, 'utf8'),
    keys.encryptionKeys,
    tokenEncryptionContext(financialSubjectId),
  );
  const created = await transaction.appAccountTokenBinding.create({
    data: {
      financialSubjectId,
      keyVersion: digest.keyVersion,
      tokenDigest: digest.digest,
      encryptedToken: new Uint8Array(encrypted.encrypted),
      encryptionKeyVersion: encrypted.keyVersion,
      validFrom: now,
      reason: current === null ? 'INITIAL' : 'ROTATION',
      rotatedFromBindingId: current?.id ?? null,
    },
  });

  return { bindingId: created.id, token };
}

/**
 * Resolves a nonnil Apple appAccountToken to its immutable recorded owner
 * using dual-read versioned HMAC lookup. Ownership history is retained, so a
 * closed binding still identifies its owner.
 */
export async function findBindingByToken(
  transaction: Prisma.TransactionClient,
  rawToken: string,
  hmacKeys: AuthenticationEnvironment['appAccountTokenHmacKeys'],
): Promise<ResolvedTokenBinding | null> {
  const candidates = createHmacDigestCandidates(normalizeToken(rawToken), hmacKeys);
  const binding = await transaction.appAccountTokenBinding.findFirst({
    where: {
      OR: candidates.map((candidate) => ({
        keyVersion: candidate.keyVersion,
        tokenDigest: candidate.digest,
      })),
    },
    orderBy: { validFrom: 'desc' },
  });
  if (binding === null) {
    return null;
  }
  return {
    bindingId: binding.id,
    financialSubjectId: binding.financialSubjectId,
    validFrom: binding.validFrom,
    validTo: binding.validTo,
  };
}

/**
 * Crypto-erases every recoverable raw token for a financial subject during
 * account purge. Digests remain so retained post-purge Apple events still
 * route to their immutable owner; the raw values become unrecoverable.
 */
export async function eraseRecoverableTokens(
  transaction: Prisma.TransactionClient,
  financialSubjectId: string,
  now: Date,
): Promise<number> {
  const result = await transaction.appAccountTokenBinding.updateMany({
    where: { financialSubjectId, encryptedToken: { not: null } },
    data: {
      encryptedToken: null,
      encryptionKeyVersion: null,
      cryptoErasedAt: now,
    },
  });
  await transaction.appAccountTokenBinding.updateMany({
    where: { financialSubjectId, validTo: null },
    data: { validTo: now },
  });
  return result.count;
}
