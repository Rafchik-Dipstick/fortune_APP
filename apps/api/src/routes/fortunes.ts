import { type Express, type RequestHandler } from 'express';
import {
  apiPaths,
  fortuneDrawRequestSchema,
  fortuneDrawResponseSchema,
  fortuneStateResponseSchema,
  fortuneViewedResponseSchema,
  idempotencyKeySchema,
  uuidSchema,
  type FortuneDrawRequest,
  type FortuneDrawResponse,
  type FortuneStateResponse,
  type FortuneViewedResponse,
} from '@fortuneness/api-contracts';

import { FortuneStateError } from '../fortune/state.js';
import { FortuneViewedError } from '../fortune/viewed.js';
import { FortuneDrawError, type FortuneDrawResult } from '../fortune/draw.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { ApiHttpError } from '../middleware/errors.js';
import type { FortuneDrawTelemetry } from '../observability/fortune-draw-telemetry.js';

export interface FortuneStateHandler {
  get(authentication: AuthenticationContext): Promise<FortuneStateResponse>;
}

export interface FortuneDrawHandler {
  draw(
    authentication: AuthenticationContext,
    request: FortuneDrawRequest,
    idempotencyKey: string,
  ): Promise<FortuneDrawResult>;
}

export interface FortuneViewedHandler {
  markViewed(authentication: AuthenticationContext, drawId: string): Promise<FortuneViewedResponse>;
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

function mapFortuneDrawError(error: FortuneDrawError): ApiHttpError {
  switch (error.code) {
    case 'ACCOUNT_DELETION_PENDING':
      return new ApiHttpError({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'The account is pending deletion.',
        sameKeyRetrySafe: true,
        statusCode: 423,
      });
    case 'ACCOUNT_PURGED':
      return new ApiHttpError({
        code: 'ACCOUNT_PURGED',
        message: 'The account has been purged.',
        sameKeyRetrySafe: true,
        statusCode: 410,
      });
    case 'AUTH_REQUIRED':
      return new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'An active session is required to draw a fortune.',
        retryable: true,
        sameKeyRetrySafe: true,
        statusCode: 401,
      });
    case 'CONTENT_UNAVAILABLE':
      return new ApiHttpError({
        code: 'CONTENT_UNAVAILABLE',
        message: 'Fortune content is temporarily unavailable. No allowance was consumed.',
        retryable: true,
        sameKeyRetrySafe: true,
        statusCode: 503,
      });
    case 'IDEMPOTENCY_KEY_REUSED':
      return new ApiHttpError({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'The idempotency key was already used for a different draw request.',
        statusCode: 409,
      });
    case 'NO_DRAWS_AVAILABLE':
      return new ApiHttpError({
        code: 'NO_DRAWS_AVAILABLE',
        ...(error.details === undefined ? {} : { details: error.details }),
        message: 'No draws are currently available.',
        sameKeyRetrySafe: true,
        statusCode: 409,
      });
    case 'UNVIEWED_READING_PENDING':
      return new ApiHttpError({
        code: 'UNVIEWED_READING_PENDING',
        ...(error.details === undefined ? {} : { details: error.details }),
        message: 'Finish the current reading before drawing another.',
        sameKeyRetrySafe: true,
        statusCode: 409,
      });
  }
}

export function createFortuneDrawRoute(
  draw: FortuneDrawHandler,
  telemetry?: FortuneDrawTelemetry,
): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsedRequest = fortuneDrawRequestSchema.safeParse(request.body);
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(request.header('idempotency-key'));
    if (!parsedRequest.success || !parsedIdempotencyKey.success) {
      telemetry?.recordRejected('VALIDATION_FAILED');
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The fortune intention or idempotency key is invalid.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      const result = await draw.draw(
        request.authentication,
        parsedRequest.data,
        parsedIdempotencyKey.data,
      );
      telemetry?.recordIssued({
        allowanceSource: result.response.draw.allowanceSource,
        intention: parsedRequest.data.intention,
      });
      response.setHeader('Idempotency-Key', parsedIdempotencyKey.data);
      response
        .status(result.created ? 201 : 200)
        .json(fortuneDrawResponseSchema.parse(result.response) satisfies FortuneDrawResponse);
    } catch (error) {
      if (error instanceof FortuneDrawError) {
        telemetry?.recordRejected(error.code);
      }
      next(error instanceof FortuneDrawError ? mapFortuneDrawError(error) : error);
    }
  };
}

function mapFortuneViewedError(error: FortuneViewedError): ApiHttpError {
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
        message: 'An active session is required to acknowledge a reading.',
        retryable: true,
        statusCode: 401,
      });
    case 'NOT_FOUND':
      return new ApiHttpError({
        code: 'NOT_FOUND',
        message: 'The requested reading does not exist.',
        statusCode: 404,
      });
  }
}

export function createFortuneViewedRoute(viewed: FortuneViewedHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsedDrawId = uuidSchema.safeParse(request.params['id']);
    if (!parsedDrawId.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The reading identifier is invalid.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      response
        .status(200)
        .json(
          fortuneViewedResponseSchema.parse(
            await viewed.markViewed(request.authentication, parsedDrawId.data),
          ),
        );
    } catch (error) {
      next(error instanceof FortuneViewedError ? mapFortuneViewedError(error) : error);
    }
  };
}

export function registerFortuneRoutes(
  app: Express,
  handlers: {
    authenticate: RequestHandler;
    draw: FortuneDrawHandler;
    state: FortuneStateHandler;
    telemetry?: FortuneDrawTelemetry;
    viewed: FortuneViewedHandler;
  },
): void {
  app.get(apiPaths.fortuneState, handlers.authenticate, createFortuneStateRoute(handlers.state));
  app.post(
    apiPaths.fortuneDraw,
    handlers.authenticate,
    createFortuneDrawRoute(handlers.draw, handlers.telemetry),
  );
  app.patch(
    apiPaths.fortuneViewed,
    handlers.authenticate,
    createFortuneViewedRoute(handlers.viewed),
  );
}
