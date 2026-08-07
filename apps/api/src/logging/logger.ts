import pino, { type DestinationStream, type Logger } from 'pino';

import { type ApiEnvironment } from '../config/environment.js';
import { scrubLogObject, scrubValue } from '../security/redaction.js';

export type ApiLogger = Logger;

export type ApiLoggerEnvironment = Pick<
  ApiEnvironment,
  'deploymentEnvironment' | 'logLevel' | 'nodeEnvironment'
>;

/**
 * Structured service logger. Two layers keep private material out of the
 * stream: pino's path redaction removes the well-known request-header shapes
 * cheaply, and the log formatter deep-scrubs every remaining merged object by
 * key name and by value shape (see `security/redaction.ts`). Path redaction
 * alone cannot reach an arbitrarily nested field, which is exactly where an
 * accidental JWS or fortune body would appear.
 */
export const createApiLogger = (
  environment: ApiLoggerEnvironment,
  destination?: DestinationStream,
): ApiLogger =>
  pino(
    {
      level: environment.logLevel,
      base: {
        deployment: environment.deploymentEnvironment,
        environment: environment.nodeEnvironment,
        service: 'fortuneness-api',
      },
      formatters: {
        log: scrubLogObject,
      },
      redact: {
        paths: [
          'authorization',
          'cookie',
          'password',
          'token',
          '*.authorization',
          '*.cookie',
          '*.password',
          '*.token',
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[Redacted]',
      },
      serializers: {
        err: (error: unknown) => scrubValue(error),
        error: (error: unknown) => scrubValue(error),
      },
    },
    ...(destination === undefined ? [] : [destination]),
  );
