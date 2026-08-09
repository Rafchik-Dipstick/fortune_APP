import { createHash } from 'node:crypto';

import { type AppleAuthRequest } from '@fortuneness/api-contracts';
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyOptions,
} from 'jose';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { createCurrentHmacDigest, createHmacDigestCandidates } from '../security/crypto.js';
import { AppleIdentityVerificationError } from './apple-auth-errors.js';

const appleIssuer = 'https://appleid.apple.com';
const appleJwksUrl = new URL(`${appleIssuer}/auth/keys`);
const appleIdentityPrefix = 'sign-in-with-apple:';

export function createAppleIdentityDigests(
  subject: string,
  environment: Pick<AuthenticationEnvironment, 'appleIdentityKeys'>,
): {
  currentIdentity: { digest: string; keyVersion: string };
  identityCandidates: readonly { digest: string; keyVersion: string }[];
} {
  const normalizedSubject = `${appleIdentityPrefix}${subject}`;
  return {
    currentIdentity: createCurrentHmacDigest(normalizedSubject, environment.appleIdentityKeys),
    identityCandidates: createHmacDigestCandidates(
      normalizedSubject,
      environment.appleIdentityKeys,
    ),
  };
}

export interface VerifiedAppleIdentity {
  authenticatedAt: Date;
  currentIdentity: { digest: string; keyVersion: string };
  identityCandidates: readonly { digest: string; keyVersion: string }[];
  proofExpiresAt: Date;
  proofFingerprint: string;
}

type JwtVerifier = (token: string, options: JWTVerifyOptions) => Promise<{ payload: JWTPayload }>;

function isAppleKeyAvailabilityError(error: unknown): boolean {
  return error instanceof errors.JWKSTimeout || error instanceof TypeError;
}

export class AppleIdentityTokenVerifier {
  private readonly verifyJwt: JwtVerifier;

  constructor(
    private readonly environment: AuthenticationEnvironment,
    private readonly now: () => Date = () => new Date(),
    verifyJwt?: JwtVerifier,
  ) {
    const remoteKeys = createRemoteJWKSet(appleJwksUrl, {
      timeoutDuration: environment.appleIdentityJwksTimeoutMs,
    });
    this.verifyJwt =
      verifyJwt ??
      ((token, options) =>
        jwtVerify(token, remoteKeys, {
          ...options,
          algorithms: ['RS256'],
          audience: environment.bundleId,
          issuer: appleIssuer,
        }));
  }

  async verify(request: AppleAuthRequest): Promise<VerifiedAppleIdentity> {
    const now = this.now();
    let payload: JWTPayload;
    try {
      ({ payload } = await this.verifyJwt(request.identityToken, {
        algorithms: ['RS256'],
        audience: this.environment.bundleId,
        clockTolerance: this.environment.appleIdentityTokenClockSkewSeconds,
        currentDate: now,
        issuer: appleIssuer,
      }));
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new AppleIdentityVerificationError('TOKEN_EXPIRED', error);
      }
      throw new AppleIdentityVerificationError(
        isAppleKeyAvailabilityError(error) ? 'KEY_UNAVAILABLE' : 'INVALID_TOKEN',
        error,
      );
    }

    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      payload.sub.length > 256 ||
      typeof payload.iat !== 'number' ||
      !Number.isInteger(payload.iat) ||
      typeof payload.exp !== 'number' ||
      !Number.isInteger(payload.exp) ||
      payload['nonce'] !== request.nonce
    ) {
      throw new AppleIdentityVerificationError('INVALID_TOKEN');
    }

    const authenticatedAt = new Date(payload.iat * 1_000);
    const ageMs = now.getTime() - authenticatedAt.getTime();
    if (
      ageMs > this.environment.appleIdentityTokenMaxAgeSeconds * 1_000 ||
      ageMs < -this.environment.appleIdentityTokenClockSkewSeconds * 1_000
    ) {
      throw new AppleIdentityVerificationError('TOKEN_EXPIRED');
    }

    const identities = createAppleIdentityDigests(payload.sub, this.environment);
    return {
      authenticatedAt,
      ...identities,
      proofExpiresAt: new Date(payload.exp * 1_000),
      proofFingerprint: createHash('sha256').update(request.identityToken, 'utf8').digest('hex'),
    };
  }
}
