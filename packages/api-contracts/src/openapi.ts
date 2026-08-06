import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  apiErrorEnvelopeSchema,
  apiPaths,
  gameCenterAuthRequestSchema,
  gameCenterAuthResponseSchema,
  fortuneDrawRequestSchema,
  fortuneDrawResponseSchema,
  fortuneStateResponseSchema,
  fortuneViewedResponseSchema,
  healthResponseSchema,
  idempotencyKeySchema,
  meResponseSchema,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  stableApiErrorCodes,
  uuidSchema,
} from './index.js';

export const generateOpenApiDocument = () => {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

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

  registry.registerPath({
    method: 'post',
    path: apiPaths.authGameCenter,
    description:
      'Verifies a fresh, persistent Game Center identity proof and returns authoritative account bootstrap and rotating session tokens.',
    summary: 'Authenticate with Game Center',
    tags: ['Authentication'],
    request: {
      body: {
        content: { 'application/json': { schema: gameCenterAuthRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'The proof was verified and an active session was issued.',
        content: { 'application/json': { schema: gameCenterAuthResponseSchema } },
      },
      400: {
        description: 'The proof or advisory device context is malformed.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The proof is invalid, stale, or signed for another bundle.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      409: {
        description: 'The player identifiers are not persistent.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'A stale retained identity points at an already purged account.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account is pending deletion and no normal session was issued.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description:
          'Apple proof verification or stable database state is temporarily unavailable.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: apiPaths.fortuneViewed.replace(':id', '{id}'),
    description:
      'Idempotently marks one owned immutable reading viewed after all reveal copy is rendered and reachable.',
    summary: 'Acknowledge a revealed fortune',
    tags: ['Fortunes'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      200: {
        description: 'The owned reading with its stable viewed timestamp.',
        content: { 'application/json': { schema: fortuneViewedResponseSchema } },
      },
      400: {
        description: 'The reading identifier is malformed.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      404: {
        description: 'The reading is absent or belongs to another account.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'The account has already been purged.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account is pending deletion.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description: 'Stable database state is temporarily unavailable.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: apiPaths.authRefresh,
    description:
      'Atomically consumes one refresh token and returns exactly one replacement. Exact same-key retries may replay the encrypted receipt for up to 120 seconds.',
    summary: 'Rotate a session',
    tags: ['Authentication'],
    request: {
      headers: z.object({
        'Idempotency-Key': idempotencyKeySchema,
      }),
      body: {
        content: { 'application/json': { schema: refreshSessionRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'The refresh token was rotated or an exact replay was returned.',
        content: { 'application/json': { schema: refreshSessionResponseSchema } },
      },
      400: {
        description: 'The request or idempotency key is malformed.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The refresh token or session family is invalid.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      409: {
        description: 'The idempotency key was reused for different input.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'The account has already been purged.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account entered deletion pending before refresh could commit.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description: 'Stable database state is temporarily unavailable.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: apiPaths.authLogout,
    description: 'Revokes the current refresh-token family after authoritative session checks.',
    summary: 'Log out the current session',
    tags: ['Authentication'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'The current session family was revoked.' },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'The account was purged before logout could commit.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account entered deletion pending before logout could commit.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description: 'Stable database state is temporarily unavailable.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: apiPaths.me,
    description: 'Returns authoritative account preferences and bootstrap context.',
    summary: 'Get the active account',
    tags: ['Account'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The active account and current bootstrap context.',
        content: { 'application/json': { schema: meResponseSchema } },
      },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'The account was purged before bootstrap could commit.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account is pending deletion.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: apiPaths.fortuneState,
    description:
      'Returns server-clock allowance, subscription, monotonic period, time-zone, pack-credit, and resumable-reading state.',
    summary: 'Get authoritative fortune state',
    tags: ['Fortunes'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The active account fortune state and any owned unviewed reading.',
        content: { 'application/json': { schema: fortuneStateResponseSchema } },
      },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'The account has already been purged.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account is pending deletion.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description: 'Stable database state is temporarily unavailable.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: apiPaths.fortuneDraw,
    description:
      'Atomically selects server-owned content and consumes exactly one allowance after authoritative locks and keyed request validation.',
    summary: 'Draw one fortune',
    tags: ['Fortunes'],
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'Idempotency-Key': idempotencyKeySchema,
      }),
      body: {
        content: { 'application/json': { schema: fortuneDrawRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'An exact same-key issuance replay returned the original draw.',
        content: { 'application/json': { schema: fortuneDrawResponseSchema } },
      },
      201: {
        description: 'A new immutable fortune was issued and saved.',
        content: { 'application/json': { schema: fortuneDrawResponseSchema } },
      },
      400: {
        description: 'The intention or idempotency key is malformed.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      409: {
        description:
          'The key was reused for other input, an unviewed reading is pending, or no allowance remains.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      410: {
        description: 'The account has already been purged.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      423: {
        description: 'The account is pending deletion.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description:
          'Content is incomplete or stable database state could not be acquired after bounded retries.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
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
    tags: [
      { name: 'Operations' },
      { name: 'Authentication' },
      { name: 'Account' },
      { name: 'Fortunes' },
    ],
    'x-stable-error-codes': [...stableApiErrorCodes],
  });
};
