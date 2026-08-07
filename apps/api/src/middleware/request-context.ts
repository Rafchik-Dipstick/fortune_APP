import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { type RequestHandler } from 'express';
import { z } from 'zod';

import { type ApiLogger } from '../logging/logger.js';
import { type RouteLatencyRecorder } from '../observability/metrics.js';
import { matchedRoutePattern } from './route-name.js';

const requestIdSchema = z.uuid();

export type RequestIdFactory = () => string;

export interface RequestContextDependencies {
  metrics?: RouteLatencyRecorder;
}

export const createRequestContext = (
  logger: ApiLogger,
  createRequestId: RequestIdFactory = randomUUID,
  dependencies: RequestContextDependencies = {},
): RequestHandler => {
  const { metrics } = dependencies;

  return (request, response, next) => {
    const suppliedRequestId = request.get('x-request-id');
    const parsedRequestId = requestIdSchema.safeParse(suppliedRequestId);
    const requestId = parsedRequestId.success ? parsedRequestId.data : createRequestId();
    const startedAt = performance.now();

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    response.once('finish', () => {
      const durationMs = performance.now() - startedAt;
      logger.info(
        {
          durationMs: Number(durationMs.toFixed(2)),
          method: request.method,
          path: request.path,
          requestId,
          statusCode: response.statusCode,
        },
        'request completed',
      );
      // Metrics are keyed by the matched route pattern, never the resolved
      // path, so a draw or card identifier can never become a metric label.
      metrics?.recordRoute({
        durationMs,
        method: request.method,
        route: matchedRoutePattern(request),
        statusCode: response.statusCode,
      });
    });

    next();
  };
};
