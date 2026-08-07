import { createHash, constants, verify, type KeyObject } from 'node:crypto';

import { type GameCenterAuthRequest } from '@fortuneness/api-contracts';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { createCurrentHmacDigest, createHmacDigestCandidates } from '../security/crypto.js';
import { GameCenterVerificationError } from './game-center-errors.js';
import { type GameCenterPublicKeyProvider } from './game-center-public-key.js';
import { validateAllowedCertificateUrl } from './safe-remote-certificate.js';

export interface VerifiedGameCenterIdentity {
  authenticatedAt: Date;
  currentIdentity: { digest: string; keyVersion: string };
  identityCandidates: readonly { digest: string; keyVersion: string }[];
  proofExpiresAt: Date;
  proofFingerprint: string;
  secondaryMigrationIdentity: { digest: string; keyVersion: string };
}

export function createGameCenterSignedBytes(
  teamPlayerId: string,
  bundleId: string,
  timestamp: bigint,
  salt: Buffer,
): Buffer {
  const encodedTimestamp = Buffer.alloc(8);
  encodedTimestamp.writeBigUInt64BE(timestamp);
  return Buffer.concat([
    Buffer.from(teamPlayerId, 'utf8'),
    Buffer.from(bundleId, 'utf8'),
    encodedTimestamp,
    salt,
  ]);
}

function createProofFingerprint(signedBytes: Buffer, signature: Buffer): string {
  return createHash('sha256')
    .update(Buffer.from(String(signedBytes.length), 'ascii'))
    .update(Buffer.from(':', 'ascii'))
    .update(signedBytes)
    .update(Buffer.from(String(signature.length), 'ascii'))
    .update(Buffer.from(':', 'ascii'))
    .update(signature)
    .digest('hex');
}

export class GameCenterProofVerifier {
  constructor(
    private readonly environment: AuthenticationEnvironment,
    private readonly publicKeyProvider: GameCenterPublicKeyProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verify(request: GameCenterAuthRequest): Promise<VerifiedGameCenterIdentity> {
    if (!request.scopedIdsPersistent && !this.environment.allowNonPersistentGameCenterIds) {
      throw new GameCenterVerificationError('NONPERSISTENT_ID');
    }
    if (request.proof.bundleId !== this.environment.bundleId) {
      throw new GameCenterVerificationError('BUNDLE_MISMATCH');
    }

    const timestamp = BigInt(request.proof.timestamp);
    if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new GameCenterVerificationError('INVALID_PROOF');
    }
    const proofTime = Number(timestamp);
    const now = this.now();
    const ageMs = now.getTime() - proofTime;
    if (
      ageMs > this.environment.gameCenterProofMaxAgeSeconds * 1_000 ||
      ageMs < -this.environment.gameCenterProofClockSkewSeconds * 1_000
    ) {
      throw new GameCenterVerificationError('PROOF_EXPIRED');
    }

    const salt = Buffer.from(request.proof.saltBase64, 'base64');
    const signature = Buffer.from(request.proof.signatureBase64, 'base64');
    const signedBytes = createGameCenterSignedBytes(
      request.proof.teamPlayerId,
      request.proof.bundleId,
      timestamp,
      salt,
    );

    try {
      validateAllowedCertificateUrl(
        request.proof.publicKeyUrl,
        this.environment.gameCenterPublicKeyHosts,
      );
    } catch (error) {
      throw new GameCenterVerificationError('INVALID_PROOF', error);
    }

    let publicKey: KeyObject;
    try {
      publicKey = await this.publicKeyProvider.getPublicKey(request.proof.publicKeyUrl, now);
    } catch (error) {
      throw new GameCenterVerificationError('KEY_UNAVAILABLE', error);
    }

    const signatureValid = verify(
      'RSA-SHA256',
      signedBytes,
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      signature,
    );
    if (!signatureValid) {
      throw new GameCenterVerificationError('INVALID_PROOF');
    }

    return {
      authenticatedAt: new Date(proofTime),
      currentIdentity: createCurrentHmacDigest(
        request.proof.teamPlayerId,
        this.environment.gameCenterIdentityKeys,
      ),
      identityCandidates: createHmacDigestCandidates(
        request.proof.teamPlayerId,
        this.environment.gameCenterIdentityKeys,
      ),
      secondaryMigrationIdentity: createCurrentHmacDigest(
        request.proof.gamePlayerId,
        this.environment.gameCenterIdentityKeys,
      ),
      proofExpiresAt: new Date(
        proofTime + (this.environment.gameCenterProofMaxAgeSeconds + 600) * 1_000,
      ),
      proofFingerprint: createProofFingerprint(signedBytes, signature),
    };
  }
}
