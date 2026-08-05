import pino, { type Logger } from 'pino';

import { type ApiEnvironment } from '../config/environment.js';

export type ApiLogger = Logger;

export const createApiLogger = (
  environment: Pick<ApiEnvironment, 'logLevel' | 'nodeEnvironment'>,
): ApiLogger =>
  pino({
    level: environment.logLevel,
    base: {
      environment: environment.nodeEnvironment,
      service: 'fortuneness-api',
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
      ],
      censor: '[Redacted]',
    },
  });
