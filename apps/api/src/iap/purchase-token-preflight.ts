import { type VersionedKeyRing } from '../config/environment.js';
import { type Prisma } from '../generated/prisma/client.js';
import { decryptBytes } from '../security/crypto.js';
import { tokenEncryptionContext } from './purchase-token.js';

/**
 * Raised when the configured app-account-token key ring cannot open ciphertext
 * the database already holds under the same version label. The two are then
 * different key material wearing the same name, which no request-time recovery
 * can repair: rotating would mint a new appAccountToken for every player and
 * break reconciliation of the transactions Apple still reports under the old
 * one. The only safe response is to refuse the deployment.
 */
export class PurchaseTokenKeyMismatchError extends Error {
  constructor(readonly keyVersion: string) {
    super(
      `The configured app-account-token encryption key "${keyVersion}" cannot decrypt stored purchase tokens written under that same version. The deployment is configured with different key material than the database was written with.`,
    );
    this.name = 'PurchaseTokenKeyMismatchError';
  }
}

export type PurchaseTokenPreflightOutcome =
  | { checkedVersions: string[]; status: 'verified' }
  | { status: 'skipped' };

type BindingReader = Pick<Prisma.TransactionClient['appAccountTokenBinding'], 'findFirst'>;

/**
 * Proves at startup that every key version the ring claims to hold can still
 * open the ciphertext stored under it.
 *
 * A version absent from the ring is deliberately not an error: that is a
 * retirement, and `resolveCurrentPurchaseToken` rotates those bindings on
 * demand. What cannot be recovered at request time -- and so must be caught
 * before traffic arrives -- is a version that is present but wrong, which
 * otherwise surfaces only as an unexplained 500 on every catalog request for
 * the affected players.
 *
 * A database that cannot be read yields `skipped` rather than a failure. The
 * readiness probe already covers an unavailable database, and turning a
 * transient outage into a refusal to boot would trade a recoverable condition
 * for a crash loop.
 */
export async function verifyPurchaseTokenEncryptionKeys(
  bindings: BindingReader,
  encryptionKeys: VersionedKeyRing,
): Promise<PurchaseTokenPreflightOutcome> {
  const checkedVersions: string[] = [];

  for (const keyVersion of Object.keys(encryptionKeys.keys)) {
    let sample: Awaited<ReturnType<BindingReader['findFirst']>>;
    try {
      // Closed bindings are deliberately out of scope. Their ciphertext is
      // never opened again -- ownership history is resolved by HMAC digest, not
      // decryption -- so a retired one that no longer decrypts is inert, and
      // refusing to boot over it would block a deployment nothing can reach.
      sample = await bindings.findFirst({
        where: { encryptionKeyVersion: keyVersion, encryptedToken: { not: null }, validTo: null },
        orderBy: { validFrom: 'desc' },
      });
    } catch {
      return { status: 'skipped' };
    }

    if (sample?.encryptedToken == null) {
      continue;
    }

    try {
      decryptBytes(
        Buffer.from(sample.encryptedToken),
        keyVersion,
        encryptionKeys,
        tokenEncryptionContext(sample.financialSubjectId),
      );
    } catch {
      throw new PurchaseTokenKeyMismatchError(keyVersion);
    }

    checkedVersions.push(keyVersion);
  }

  return { checkedVersions, status: 'verified' };
}
