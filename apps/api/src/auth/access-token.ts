import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { type AuthenticationEnvironment } from '../config/environment.js';

const accessTokenClaimsSchema = z.looseObject({
  sub: z.uuid(),
  sid: z.uuid(),
  sv: z.number().int().positive(),
  auth_time: z.number().int().nonnegative(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export interface AccessTokenClaims {
  authTimeSeconds: number;
  expiresAt: Date;
  issuedAt: Date;
  sessionFamilyId: string;
  sessionVersion: number;
  userId: string;
}

export class AccessTokenError extends Error {
  constructor(cause?: unknown) {
    super('Access token is invalid.', { cause });
    this.name = 'AccessTokenError';
  }
}

function numericDate(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

export class AccessTokenService {
  constructor(
    private readonly environment: AuthenticationEnvironment,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(options: {
    authTime: Date;
    sessionFamilyId: string;
    sessionVersion: number;
    userId: string;
  }): Promise<{ accessToken: string; expiresAt: Date }> {
    const now = this.now();
    const issuedAt = numericDate(now);
    const expiresAt = new Date((issuedAt + this.environment.jwtAccessTtlSeconds) * 1_000);
    const key = this.environment.jwtAccessKeys.keys[this.environment.jwtAccessKeys.currentVersion];
    if (key === undefined) {
      throw new Error('Current access-token key is unavailable.');
    }

    const accessToken = await new SignJWT({
      sid: options.sessionFamilyId,
      sv: options.sessionVersion,
      auth_time: numericDate(options.authTime),
    })
      .setProtectedHeader({
        alg: 'HS256',
        kid: this.environment.jwtAccessKeys.currentVersion,
        typ: 'JWT',
      })
      .setSubject(options.userId)
      .setIssuer(this.environment.jwtIssuer)
      .setAudience(this.environment.jwtAudience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(numericDate(expiresAt))
      .sign(key);

    return { accessToken, expiresAt };
  }

  async verify(accessToken: string): Promise<AccessTokenClaims> {
    try {
      const result = await jwtVerify(
        accessToken,
        (protectedHeader) => {
          if (protectedHeader.alg !== 'HS256' || protectedHeader.kid === undefined) {
            throw new AccessTokenError();
          }
          const key = this.environment.jwtAccessKeys.keys[protectedHeader.kid];
          if (key === undefined) {
            throw new AccessTokenError();
          }
          return key;
        },
        {
          algorithms: ['HS256'],
          audience: this.environment.jwtAudience,
          issuer: this.environment.jwtIssuer,
          clockTolerance: 5,
          currentDate: this.now(),
        },
      );
      const claims = accessTokenClaimsSchema.parse(result.payload);
      return {
        userId: claims.sub,
        sessionFamilyId: claims.sid,
        sessionVersion: claims.sv,
        authTimeSeconds: claims.auth_time,
        issuedAt: new Date(claims.iat * 1_000),
        expiresAt: new Date(claims.exp * 1_000),
      };
    } catch (error) {
      if (error instanceof AccessTokenError) {
        throw error;
      }
      throw new AccessTokenError(error);
    }
  }
}
