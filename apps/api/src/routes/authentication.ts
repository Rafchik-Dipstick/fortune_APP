import { type Express, type RequestHandler } from 'express';
import {
  apiPaths,
  gameCenterAuthRequestSchema,
  gameCenterAuthResponseSchema,
  type GameCenterAuthRequest,
  type GameCenterAuthResponse,
} from '@fortuneness/api-contracts';

import { GameCenterLoginError } from '../auth/game-center-login.js';
import { GameCenterVerificationError } from '../auth/game-center-errors.js';
import { ApiHttpError } from '../middleware/errors.js';

export interface GameCenterLoginHandler {
  login(request: GameCenterAuthRequest): Promise<GameCenterAuthResponse>;
}

function mapVerificationError(error: GameCenterVerificationError): ApiHttpError {
  switch (error.code) {
    case 'NONPERSISTENT_ID':
      return new ApiHttpError({
        code: 'GAME_CENTER_ID_NOT_PERSISTENT',
        message: 'Game Center did not provide persistent scoped identifiers.',
        retryable: true,
        statusCode: 409,
      });
    case 'PROOF_EXPIRED':
      return new ApiHttpError({
        code: 'GAME_CENTER_PROOF_EXPIRED',
        message: 'The Game Center proof is no longer fresh.',
        retryable: true,
        statusCode: 401,
      });
    case 'KEY_UNAVAILABLE':
      return new ApiHttpError({
        code: 'GAME_CENTER_UNAVAILABLE',
        message: 'Game Center verification is temporarily unavailable.',
        retryable: true,
        statusCode: 503,
      });
    case 'BUNDLE_MISMATCH':
    case 'INVALID_PROOF':
      return new ApiHttpError({
        code: 'GAME_CENTER_PROOF_INVALID',
        message: 'The Game Center proof is invalid.',
        statusCode: 401,
      });
  }
}

function mapLoginError(error: GameCenterLoginError): ApiHttpError | undefined {
  switch (error.code) {
    case 'PROOF_REPLAY':
      return new ApiHttpError({
        code: 'GAME_CENTER_PROOF_INVALID',
        message: 'The Game Center proof has already been used.',
        statusCode: 401,
      });
    case 'TIME_ZONE_INVALID':
      return new ApiHttpError({
        code: 'VALIDATION_FAILED',
        message: 'The reported device time zone is invalid.',
        statusCode: 400,
      });
    case 'ACCOUNT_BLOCKED':
      return new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'The account cannot establish a session.',
        statusCode: 401,
      });
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
    case 'IDENTITY_CONFLICT':
      return undefined;
  }
}

export function createGameCenterLoginRoute(login: GameCenterLoginHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsedRequest = gameCenterAuthRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The Game Center authentication request is invalid.',
          statusCode: 400,
        }),
      );
      return;
    }

    try {
      const result = gameCenterAuthResponseSchema.parse(await login.login(parsedRequest.data));
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof GameCenterVerificationError) {
        next(mapVerificationError(error));
        return;
      }
      if (error instanceof GameCenterLoginError) {
        next(mapLoginError(error) ?? error);
        return;
      }
      next(error);
    }
  };
}

export function registerAuthenticationRoutes(app: Express, login: GameCenterLoginHandler): void {
  app.post(apiPaths.authGameCenter, createGameCenterLoginRoute(login));
}
