import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { resolveVersionedKey } from '../security/crypto.js';

/**
 * Deletion-management tokens carry their own audience so an ordinary access
 * token can never reach the deletion routes, and — more importantly — this
 * token can never reach an application route. Reauthenticating while deletion
 * is pending must not silently restore access (spec section 6.3).
 */
export const deletionManagementAudienceSuffix = ':deletion-management';
export const deletionManagementTtlSeconds = 900;

const claimsSchema = z.looseObject({
  sub: z.uuid(),
  scope: z.literal('deletion-management'),
  auth_time: z.number().int().nonnegative(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export interface DeletionManagementClaims {
  /** Authoritative Apple sign-in time this token was minted from. */
  authTime: Date;
  expiresAt: Date;
  userId: string;
}

export class DeletionManagementTokenError extends Error {
  constructor(cause?: unknown) {
    super('Deletion-management token is invalid.', { cause });
    this.name = 'DeletionManagementTokenError';
  }
}

function numericDate(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

export class DeletionManagementTokenService {
  constructor(
    private readonly environment: AuthenticationEnvironment,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get audience(): string {
    return `${this.environment.jwtAudience}${deletionManagementAudienceSuffix}`;
  }

  async issue(userId: string, authenticatedAt: Date): Promise<{ expiresAt: Date; token: string }> {
    const now = this.now();
    const issuedAt = numericDate(now);
    const expiresAt = new Date((issuedAt + deletionManagementTtlSeconds) * 1_000);
    const key = resolveVersionedKey(
      this.environment.jwtAccessKeys,
      this.environment.jwtAccessKeys.currentVersion,
    );
    if (key === undefined) {
      throw new Error('Current access-token key is unavailable.');
    }

    const token = await new SignJWT({
      scope: 'deletion-management',
      auth_time: numericDate(authenticatedAt),
    })
      .setProtectedHeader({
        alg: 'HS256',
        kid: this.environment.jwtAccessKeys.currentVersion,
        typ: 'JWT',
      })
      .setSubject(userId)
      .setIssuer(this.environment.jwtIssuer)
      .setAudience(this.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(numericDate(expiresAt))
      .sign(key);

    return { expiresAt, token };
  }

  async verify(token: string): Promise<DeletionManagementClaims> {
    try {
      const result = await jwtVerify(
        token,
        (protectedHeader) => {
          if (protectedHeader.alg !== 'HS256' || protectedHeader.kid === undefined) {
            throw new DeletionManagementTokenError();
          }
          const key = resolveVersionedKey(this.environment.jwtAccessKeys, protectedHeader.kid);
          if (key === undefined) {
            throw new DeletionManagementTokenError();
          }
          return Promise.resolve(key);
        },
        {
          algorithms: ['HS256'],
          audience: this.audience,
          issuer: this.environment.jwtIssuer,
          // The same process issues and verifies this token, so there is no
          // peer clock to tolerate.
          clockTolerance: 0,
          currentDate: this.now(),
        },
      );
      const claims = claimsSchema.parse(result.payload);
      return {
        authTime: new Date(claims.auth_time * 1_000),
        expiresAt: new Date(claims.exp * 1_000),
        userId: claims.sub,
      };
    } catch (error) {
      throw new DeletionManagementTokenError(error);
    }
  }
}
