import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { type RequestHandler } from 'express';
import { z } from 'zod';

import { type ApiLogger } from '../logging/logger.js';

const requestIdSchema = z.uuid();

export type RequestIdFactory = () => string;

export const createRequestContext =
  (logger: ApiLogger, createRequestId: RequestIdFactory = randomUUID): RequestHandler =>
  (request, response, next) => {
    const suppliedRequestId = request.get('x-request-id');
    const parsedRequestId = requestIdSchema.safeParse(suppliedRequestId);
    const requestId = parsedRequestId.success ? parsedRequestId.data : createRequestId();
    const startedAt = performance.now();

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    response.once('finish', () => {
      logger.info(
        {
          durationMs: Number((performance.now() - startedAt).toFixed(2)),
          method: request.method,
          path: request.path,
          requestId,
          statusCode: response.statusCode,
        },
        'request completed',
      );
    });

    next();
  };
