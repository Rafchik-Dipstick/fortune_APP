import { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';

import { type ApiLogger } from '../logging/logger.js';

interface ApiErrorBody {
  code: string;
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
  readonly code: string;
  readonly retryable: boolean;
  readonly sameKeyRetrySafe: boolean;
  readonly statusCode: number;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    sameKeyRetrySafe?: boolean;
    statusCode: number;
  }) {
    super(options.message);
    this.name = 'ApiHttpError';
    this.code = options.code;
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
  response.status(statusCode).json({
    error: {
      ...error,
      requestId,
    },
  });
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
  (logger: ApiLogger): ErrorRequestHandler =>
  (error: unknown, request, response, _next) => {
    if (error instanceof ApiHttpError) {
      sendApiError(response, error.statusCode, request.requestId, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        sameKeyRetrySafe: error.sameKeyRetrySafe,
      });
      return;
    }

    if (hasHttpMetadata(error) && error.type === 'entity.too.large') {
      sendApiError(response, 413, request.requestId, {
        code: 'PAYLOAD_TOO_LARGE',
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
        code: 'INVALID_JSON',
        message: 'The request body must contain valid JSON.',
        retryable: false,
        sameKeyRetrySafe: false,
      });
      return;
    }

    logger.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        requestId: request.requestId,
      },
      'unhandled request error',
    );
    sendApiError(response, 500, request.requestId, {
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
      retryable: true,
      sameKeyRetrySafe: true,
    });
  };
