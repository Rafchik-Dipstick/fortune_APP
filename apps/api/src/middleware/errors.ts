import { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';
import { apiErrorEnvelopeSchema, type ApiErrorCode } from '@fortuneness/api-contracts';

import { DatabaseError } from '../db/errors.js';
import { type ApiLogger } from '../logging/logger.js';
import { type ErrorReporter, NoopErrorReporter } from '../observability/error-reporter.js';
import { matchedRoutePattern } from './route-name.js';

interface ApiErrorBody {
  code: ApiErrorCode;
  details?: Record<string, unknown>;
  message: string;
  requestId: string;
  retryable: boolean;
  sameKeyRetrySafe: boolean;
}

interface ErrorWithHttpMetadata {
  status?: unknown;
  type?: unknown;
}

export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;
  readonly sameKeyRetrySafe: boolean;
  readonly statusCode: number;

  constructor(options: {
    code: ApiErrorCode;
    details?: Record<string, unknown>;
    message: string;
    retryable?: boolean;
    sameKeyRetrySafe?: boolean;
    statusCode: number;
  }) {
    super(options.message);
    this.name = 'ApiHttpError';
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.sameKeyRetrySafe = options.sameKeyRetrySafe ?? false;
    this.statusCode = options.statusCode;
  }
}

export const sendApiError = (
  response: Response,
  statusCode: number,
  requestId: string,
  error: Omit<ApiErrorBody, 'requestId'>,
): void => {
  const body = apiErrorEnvelopeSchema.parse({
    error: {
      ...error,
      requestId,
    },
  });
  response.status(statusCode).json(body);
};

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new ApiHttpError({
      code: 'NOT_FOUND',
      message: 'The requested resource does not exist.',
      statusCode: 404,
    }),
  );
};

const hasHttpMetadata = (error: unknown): error is ErrorWithHttpMetadata =>
  typeof error === 'object' && error !== null;

export const createErrorHandler =
  (logger: ApiLogger, reporter: ErrorReporter = new NoopErrorReporter()): ErrorRequestHandler =>
  (error: unknown, request, response, _next) => {
    if (error instanceof ApiHttpError) {
      sendApiError(response, error.statusCode, request.requestId, {
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
        message: error.message,
        retryable: error.retryable,
        sameKeyRetrySafe: error.sameKeyRetrySafe,
      });
      return;
    }

    if (error instanceof DatabaseError && error.retryable) {
      sendApiError(response, 503, request.requestId, {
        code: 'RETRYABLE_CONFLICT',
        message: 'The operation could not acquire stable database state. Retry the same request.',
        retryable: true,
        sameKeyRetrySafe: true,
      });
      return;
    }

    if (hasHttpMetadata(error) && error.type === 'entity.too.large') {
      sendApiError(response, 400, request.requestId, {
        code: 'VALIDATION_FAILED',
        message: 'The request body exceeds the allowed size.',
        retryable: false,
        sameKeyRetrySafe: false,
      });
      return;
    }

    if (
      error instanceof SyntaxError &&
      hasHttpMetadata(error) &&
      error.status === 400 &&
      error.type === 'entity.parse.failed'
    ) {
      sendApiError(response, 400, request.requestId, {
        code: 'VALIDATION_FAILED',
        message: 'The request body must contain valid JSON.',
        retryable: false,
        sameKeyRetrySafe: false,
      });
      return;
    }

    // Only genuinely unexpected failures are reported. Every branch above is
    // a normal, contract-defined outcome and would be noise in the issue feed.
    logger.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        requestId: request.requestId,
      },
      'unhandled request error',
    );
    reporter.capture(error, {
      operation: `${request.method} ${matchedRoutePattern(request)}`,
      requestId: request.requestId,
      source: 'request',
    });
    sendApiError(response, 500, request.requestId, {
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
      retryable: true,
      sameKeyRetrySafe: true,
    });
  };
