import { type RequestHandler } from 'express';

import { type ApiLogger } from '../logging/logger.js';
import { sendApiError } from './errors.js';

/**
 * Bounds how long a single request may occupy a worker.
 *
 * The database aborts first — `DATABASE_STATEMENT_TIMEOUT_MS` is validated to
 * be shorter than this deadline — so the usual failure is a clean query abort
 * and this handler only fires when something outside the database stalls.
 *
 * The response is the existing retryable envelope rather than a new stable
 * error code: every mutation in this API is idempotency-keyed, so replaying
 * the same request is the correct client behaviour and needs no new contract.
 */
export const createRequestTimeout =
  (timeoutMs: number, logger: ApiLogger): RequestHandler =>
  (request, response, next) => {
    const timer = setTimeout(() => {
      if (response.headersSent || response.writableEnded) {
        return;
      }
      logger.warn(
        {
          method: request.method,
          path: request.path,
          requestId: request.requestId,
          timeoutMs,
        },
        'request exceeded its deadline',
      );
      sendApiError(response, 503, request.requestId, {
        code: 'RETRYABLE_CONFLICT',
        message: 'The request exceeded its deadline. Retry the same request.',
        retryable: true,
        sameKeyRetrySafe: true,
      });
    }, timeoutMs);
    timer.unref();

    response.once('close', () => {
      clearTimeout(timer);
    });
    next();
  };
