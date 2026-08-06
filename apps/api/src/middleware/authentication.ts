import { type RequestHandler } from 'express';

import { type PrismaClient } from '../generated/prisma/client.js';
import { AccessTokenError, type AccessTokenService } from '../auth/access-token.js';
import { ApiHttpError } from './errors.js';

const bearerTokenPattern = /^Bearer ([A-Za-z0-9._~-]{32,4096})$/u;

export interface AuthenticationContext {
  authTime: Date;
  authTimeSeconds: number;
  sessionFamilyId: string;
  sessionVersion: number;
  userId: string;
}

function authenticationRequired(): ApiHttpError {
  return new ApiHttpError({
    code: 'AUTH_REQUIRED',
    message: 'An active session is required.',
    retryable: true,
    statusCode: 401,
  });
}

export const createAuthoritativeAuthentication =
  (
    client: PrismaClient,
    accessTokens: AccessTokenService,
    now: () => Date = () => new Date(),
  ): RequestHandler =>
  async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const authorization = request.header('authorization');
      const encodedToken =
        authorization === undefined ? undefined : bearerTokenPattern.exec(authorization)?.[1];
      if (encodedToken === undefined) {
        throw authenticationRequired();
      }

      let claims;
      try {
        claims = await accessTokens.verify(encodedToken);
      } catch (error) {
        if (error instanceof AccessTokenError) {
          throw authenticationRequired();
        }
        throw error;
      }

      const family = await client.sessionFamily.findUnique({
        where: { id: claims.sessionFamilyId },
        include: { user: true },
      });
      if (
        family?.userId !== claims.userId ||
        family.revokedAt !== null ||
        family.expiresAt <= now() ||
        family.sessionVersion !== claims.sessionVersion ||
        family.user.sessionVersion !== claims.sessionVersion ||
        Math.floor(family.gameCenterAuthenticatedAt.getTime() / 1_000) !== claims.authTimeSeconds
      ) {
        throw authenticationRequired();
      }

      if (family.user.status === 'DELETION_PENDING') {
        throw new ApiHttpError({
          code: 'ACCOUNT_DELETION_PENDING',
          message: 'The account is pending deletion.',
          statusCode: 423,
        });
      }
      if (family.user.status === 'PURGED') {
        throw new ApiHttpError({
          code: 'ACCOUNT_PURGED',
          message: 'The account has been purged.',
          statusCode: 410,
        });
      }
      if (family.user.status !== 'ACTIVE') {
        throw authenticationRequired();
      }

      request.authentication = {
        userId: claims.userId,
        sessionFamilyId: claims.sessionFamilyId,
        sessionVersion: claims.sessionVersion,
        authTimeSeconds: claims.authTimeSeconds,
        authTime: new Date(claims.authTimeSeconds * 1_000),
      };
      next();
    } catch (error) {
      next(error);
    }
  };
