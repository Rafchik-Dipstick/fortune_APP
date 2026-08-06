import { type Express, type RequestHandler } from 'express';
import {
  apiPaths,
  fortuneStateResponseSchema,
  type FortuneStateResponse,
} from '@fortuneness/api-contracts';

import { FortuneStateError } from '../fortune/state.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { ApiHttpError } from '../middleware/errors.js';

export interface FortuneStateHandler {
  get(authentication: AuthenticationContext): Promise<FortuneStateResponse>;
}

function mapFortuneStateError(error: FortuneStateError): ApiHttpError {
  switch (error.code) {
    case 'ACCOUNT_DELETION_PENDING':
      return new ApiHttpError({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'The account is pending deletion.',
        statusCode: 423,
      });
    case 'ACCOUNT_PURGED':
      return new ApiHttpError({
        code: 'ACCOUNT_PURGED',
        message: 'The account has been purged.',
        statusCode: 410,
      });
    case 'AUTH_REQUIRED':
      return new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'The fortune state is unavailable for this session.',
        retryable: true,
        statusCode: 401,
      });
  }
}

export function createFortuneStateRoute(state: FortuneStateHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(fortuneStateResponseSchema.parse(await state.get(request.authentication)));
    } catch (error) {
      next(error instanceof FortuneStateError ? mapFortuneStateError(error) : error);
    }
  };
}

export function registerFortuneRoutes(
  app: Express,
  handlers: { authenticate: RequestHandler; state: FortuneStateHandler },
): void {
  app.get(apiPaths.fortuneState, handlers.authenticate, createFortuneStateRoute(handlers.state));
}
