import { type RequestHandler } from 'express';

import {
  DeletionManagementTokenError,
  type DeletionManagementTokenService,
} from '../account/deletion-management-token.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { ApiHttpError } from './errors.js';

const bearerTokenPattern = /^Bearer ([A-Za-z0-9._~-]{32,4096})$/u;

function reauthenticationRequired(): ApiHttpError {
  return new ApiHttpError({
    code: 'APPLE_ID_REAUTH_REQUIRED',
    message: 'Deletion management requires a fresh Apple sign-in.',
    retryable: true,
    statusCode: 401,
  });
}

/**
 * Guards the two deletion-management routes. It accepts only the scoped
 * token, sets `deletionManagementUserId`, and deliberately never populates
 * `request.authentication`, so a deletion-management token cannot satisfy any
 * application route even if one were misrouted through this guard.
 */
export const createDeletionManagementAuthentication =
  (
    client: PrismaClient,
    tokens: DeletionManagementTokenService,
    now: () => Date = () => new Date(),
  ): RequestHandler =>
  async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const authorization = request.header('authorization');
      const encodedToken =
        authorization === undefined ? undefined : bearerTokenPattern.exec(authorization)?.[1];
      if (encodedToken === undefined) {
        throw reauthenticationRequired();
      }

      let claims;
      try {
        claims = await tokens.verify(encodedToken);
      } catch (error) {
        if (error instanceof DeletionManagementTokenError) {
          throw reauthenticationRequired();
        }
        throw error;
      }
      if (claims.expiresAt <= now()) {
        throw reauthenticationRequired();
      }

      const user = await client.user.findUnique({
        where: { id: claims.userId },
        select: { status: true },
      });
      if (user === null) {
        throw reauthenticationRequired();
      }
      if (user.status === 'PURGED') {
        throw new ApiHttpError({
          code: 'ACCOUNT_PURGED',
          message: 'The account has been purged and cannot be restored.',
          statusCode: 410,
        });
      }

      request.deletionManagementUserId = claims.userId;
      request.deletionManagementAuthTime = claims.authTime;
      next();
    } catch (error) {
      next(error);
    }
  };
