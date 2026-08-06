import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { apiPaths } from '@fortuneness/api-contracts';

import { type ApiEnvironment } from './config/environment.js';
import { type ApiReadiness } from './health/readiness.js';
import { registerHealthRoute } from './health/route.js';
import { type ApiLogger, createApiLogger } from './logging/logger.js';
import {
  ApiHttpError,
  createErrorHandler,
  notFoundHandler,
  sendApiError,
} from './middleware/errors.js';
import { createRequestContext, type RequestIdFactory } from './middleware/request-context.js';

export interface ApiRateLimitOptions {
  max: number;
  windowMs: number;
}

export interface CreateApiAppOptions {
  configureRoutes?: (app: Express) => void;
  environment: ApiEnvironment;
  logger?: ApiLogger;
  rateLimit?: ApiRateLimitOptions;
  readiness: ApiReadiness;
  requestIdFactory?: RequestIdFactory;
}

const defaultRateLimit: ApiRateLimitOptions = {
  max: 120,
  windowMs: 60_000,
};

/**
 * Creates an isolated HTTP application without opening a network listener.
 *
 * Keeping construction side-effect free lets tests exercise the complete
 * middleware and routing stack without owning process-level resources.
 */
export const createApiApp = (options: CreateApiAppOptions): Express => {
  const app = express();
  const logger = options.logger ?? createApiLogger(options.environment);
  const rateLimitOptions = options.rateLimit ?? defaultRateLimit;

  app.disable('x-powered-by');
  app.set('trust proxy', options.environment.trustProxyHops);
  app.use(createRequestContext(logger, options.requestIdFactory));
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
  app.use(
    rateLimit({
      handler: (request, response) => {
        sendApiError(response, 429, request.requestId, {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
          retryable: true,
          sameKeyRetrySafe: true,
        });
      },
      legacyHeaders: false,
      limit: rateLimitOptions.max,
      skip: (request) => request.path === apiPaths.health,
      standardHeaders: 'draft-8',
      windowMs: rateLimitOptions.windowMs,
    }),
  );
  app.use(
    express.json({
      limit: '32kb',
      strict: true,
      type: ['application/json', 'application/*+json'],
    }),
  );

  registerHealthRoute(app, options.readiness);
  options.configureRoutes?.(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
};
