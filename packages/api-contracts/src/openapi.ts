import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import {
  apiErrorEnvelopeSchema,
  apiPaths,
  healthResponseSchema,
  stableApiErrorCodes,
} from './index.js';

export const generateOpenApiDocument = () => {
  const registry = new OpenAPIRegistry();

  registry.registerPath({
    method: 'get',
    path: apiPaths.health,
    description:
      'Reports only process and PostgreSQL readiness. It never returns versions, URLs, credentials, or dependency errors.',
    summary: 'Check API readiness',
    tags: ['Operations'],
    responses: {
      200: {
        description: 'The process is accepting traffic and PostgreSQL is reachable.',
        content: {
          'application/json': {
            schema: healthResponseSchema,
          },
        },
      },
      503: {
        description: 'The process is draining or PostgreSQL is unavailable.',
        content: {
          'application/json': {
            schema: healthResponseSchema,
          },
        },
      },
      500: {
        description: 'An unexpected server failure occurred.',
        content: {
          'application/json': {
            schema: apiErrorEnvelopeSchema,
          },
        },
      },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Fortuneness API',
      version: '0.1.0',
      description:
        'Server-authoritative contracts for the Fortuneness iPhone and iPad application.',
    },
    servers: [{ url: '/' }],
    tags: [{ name: 'Operations' }],
    'x-stable-error-codes': [...stableApiErrorCodes],
  });
};
