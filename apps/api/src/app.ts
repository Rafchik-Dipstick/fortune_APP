import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { apiPaths } from '@fortuneness/api-contracts';

import { type ApiEnvironment } from './config/environment.js';
import { type ApiReadiness } from './health/readiness.js';
import { registerHealthRoute } from './health/route.js';
import { registerLegalRoutes } from './legal/routes.js';
import { type ApiLogger, createApiLogger } from './logging/logger.js';
import { ApiHttpError, createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { createTieredRateLimit } from './middleware/rate-limits.js';
import { createRequestContext, type RequestIdFactory } from './middleware/request-context.js';
import { createRequestTimeout } from './middleware/request-timeout.js';
import { type ErrorReporter } from './observability/error-reporter.js';
import { type RouteLatencyRecorder } from './observability/metrics.js';

export interface ApiRateLimitOptions {
  max: number;
  windowMs: number;
}

export interface CreateApiAppOptions {
  configureRoutes?: (app: Express) => void;
  environment: ApiEnvironment;
  errorReporter?: ErrorReporter;
  logger?: ApiLogger;
  metrics?: RouteLatencyRecorder;
  /** Overrides every tier with one budget. Tests use this; deployments use the environment. */
  rateLimit?: ApiRateLimitOptions;
  readiness: ApiReadiness;
  requestIdFactory?: RequestIdFactory;
}

/**
 * Creates an isolated HTTP application without opening a network listener.
 *
 * Keeping construction side-effect free lets tests exercise the complete
 * middleware and routing stack without owning process-level resources.
 */
export const createApiApp = (options: CreateApiAppOptions): Express => {
  const app = express();
  const logger = options.logger ?? createApiLogger(options.environment);
  const rateLimits =
    options.rateLimit === undefined
      ? options.environment.rateLimits
      : {
          authenticationMax: options.rateLimit.max,
          defaultMax: options.rateLimit.max,
          drawMax: options.rateLimit.max,
          webhookMax: options.rateLimit.max,
          windowMs: options.rateLimit.windowMs,
        };

  app.disable('x-powered-by');
  app.set('trust proxy', options.environment.trustProxyHops);
  app.use(
    createRequestContext(logger, options.requestIdFactory, {
      ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    }),
  );
  app.use(createRequestTimeout(options.environment.requestTimeoutMs, logger));
  app.use(helmet());
  app.use(
    cors({
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-ID'],
      credentials: false,
      exposedHeaders: [
        'X-Request-ID',
        'Idempotency-Key',
        'RateLimit',
        'RateLimit-Policy',
        'Retry-After',
      ],
      maxAge: 600,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      origin: (origin, callback) => {
        if (origin === undefined || options.environment.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(
          new ApiHttpError({
            code: 'VALIDATION_FAILED',
            message: 'The request origin is not allowed.',
            statusCode: 400,
          }),
        );
      },
    }),
  );
  app.use(createTieredRateLimit(rateLimits));
  const defaultJsonParser = express.json({
    limit: '32kb',
    strict: true,
    type: ['application/json', 'application/*+json'],
  });
  // Signed-transaction batches and Apple notification envelopes carry
  // certificate chains, so these two routes get larger explicit bounds.
  const commerceJsonParser = express.json({
    limit: '3mb',
    strict: true,
    type: ['application/json', 'application/*+json'],
  });
  app.use((request, response, next) => {
    if (request.path === apiPaths.iapReconcile || request.path === apiPaths.appStoreWebhook) {
      commerceJsonParser(request, response, next);
      return;
    }
    defaultJsonParser(request, response, next);
  });

  registerHealthRoute(app, options.readiness);
  registerLegalRoutes(app, { supportEmail: options.environment.supportEmail });
  options.configureRoutes?.(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, options.errorReporter));

  return app;
};
