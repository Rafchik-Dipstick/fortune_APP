import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  apiErrorEnvelopeSchema,
  apiPaths,
  appleAuthRequestSchema,
  appleAuthResponseSchema,
  fortuneDrawRequestSchema,
  fortuneDrawResponseSchema,
  fortuneDetailResponseSchema,
  fortuneHistoryQuerySchema,
  fortuneHistoryResponseSchema,
  fortuneStateResponseSchema,
  fortuneViewedResponseSchema,
  healthResponseSchema,
  idempotencyKeySchema,
  meResponseSchema,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  stableApiErrorCodes,
  uuidSchema,
  collectionCardDetailResponseSchema,
  collectionCardReadingsQuerySchema,
  collectionResponseSchema,
  iapCatalogResponseSchema,
  iapReconcileRequestSchema,
  iapReconcileResponseSchema,
  iapStatusResponseSchema,
  iapTransactionRequestSchema,
  iapTransactionResponseSchema,
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
    path: apiPaths.authApple,
    description:
      'Verifies a fresh Sign in with Apple identity token and returns authoritative account bootstrap and rotating session tokens.',
    summary: 'Authenticate with Apple ID',
    tags: ['Authentication'],
    request: {
      body: {
        content: { 'application/json': { schema: appleAuthRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'The Apple identity token was verified and an active session was issued.',
        content: { 'application/json': { schema: appleAuthResponseSchema } },
      },
      400: {
        description: 'The identity token request or advisory device context is malformed.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The token is invalid, stale, replayed, or issued for another client.',
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
        description: 'Apple identity verification or stable database state is unavailable.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: apiPaths.fortunes,
    description:
      'Returns owned immutable readings in stable issuedAt/id descending order using a filter-bound opaque cursor.',
    summary: 'List saved fortunes',
    tags: ['Fortunes'],
    security: [{ bearerAuth: [] }],
    request: { query: fortuneHistoryQuerySchema },
    responses: {
      200: {
        description: 'One bounded page of owned readings.',
        content: { 'application/json': { schema: fortuneHistoryResponseSchema } },
      },
      400: {
        description: 'The filters, range, limit, or opaque cursor are invalid or mismatched.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
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
    },
  });

  registry.registerPath({
    method: 'get',
    path: apiPaths.fortuneDetail.replace(':id', '{id}'),
    description:
      'Returns one owned immutable reading; another account is indistinguishable from absent.',
    summary: 'Get one saved fortune',
    tags: ['Fortunes'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      200: {
        description: 'The complete owned reading snapshot.',
        content: { 'application/json': { schema: fortuneDetailResponseSchema } },
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
    },
  });

  registry.registerPath({
    method: 'get',
    path: apiPaths.collection,
    description:
      'Returns the canonical 78-card deck with owned discovery timestamps and orientation progress.',
    summary: 'Get collection progress',
    tags: ['Collection'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'All 78 canonical cards and caller-owned discovery state.',
        content: { 'application/json': { schema: collectionResponseSchema } },
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
    },
  });

  registry.registerPath({
    method: 'get',
    path: apiPaths.collectionCard.replace(':key', '{key}'),
    description:
      'Returns one canonical card plus a stable opaque-cursor page of caller-owned readings for it.',
    summary: 'Get collection card history',
    tags: ['Collection'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ key: z.string().trim().min(1).max(48) }),
      query: collectionCardReadingsQuerySchema,
    },
    responses: {
      200: {
        description: 'The canonical card discovery state and one owned reading page.',
        content: { 'application/json': { schema: collectionCardDetailResponseSchema } },
      },
      400: {
        description: 'The card key, limit, or opaque cursor is invalid or mismatched.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      404: {
        description: 'The canonical card does not exist.',
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

  registry.registerPath({
    method: 'get',
    path: apiPaths.iapCatalog,
    description:
      'Returns the allowlisted product IDs, server-owned benefit copy, grace-period policy, and the current server-issued purchase token. Prices remain StoreKit-owned.',
    summary: 'Get the commerce catalog',
    tags: ['Commerce'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The allowlisted catalog and the caller purchase token.',
        content: { 'application/json': { schema: iapCatalogResponseSchema } },
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
    path: apiPaths.iapTransactions,
    description:
      'Verifies one StoreKit signed transaction and applies its benefit exactly once through the atomic application service. Duplicate accepted delivery is normal success with appliedNow false.',
    summary: 'Deliver a signed transaction',
    tags: ['Commerce'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: { 'application/json': { schema: iapTransactionRequestSchema } },
      },
    },
    responses: {
      200: {
        description:
          'The transaction was verified and durably applied, already applied, delivered to its recorded other owner, or terminally closed without benefit.',
        content: { 'application/json': { schema: iapTransactionResponseSchema } },
      },
      400: {
        description: 'The JWS is unverified or the product is not allowlisted.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'The access token or authoritative session is no longer active.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      409: {
        description: 'No owner is identifiable; the transaction is quarantined unfinished.',
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
        description: 'A retryable lock or database failure occurred; retry without finishing.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: apiPaths.iapReconcile,
    description:
      'Independently verifies and idempotently applies up to 100 signed current or unfinished transactions enumerated by the client.',
    summary: 'Reconcile signed transactions',
    tags: ['Commerce'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: { 'application/json': { schema: iapReconcileRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'One independent disposition per submitted transaction.',
        content: { 'application/json': { schema: iapReconcileResponseSchema } },
      },
      400: {
        description: 'The batch shape or an item exceeds the documented bounds.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
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
    method: 'get',
    path: apiPaths.iapStatus,
    description:
      'Returns the caller-owned normalized subscription entitlement, nonnegative spendable pack balance, and commerce-review lock state.',
    summary: 'Get commerce status',
    tags: ['Commerce'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The caller-owned entitlement and pack balance.',
        content: { 'application/json': { schema: iapStatusResponseSchema } },
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
    path: apiPaths.appStoreWebhook,
    description:
      'Receives App Store Server Notifications V2. The outer and nested JWS are verified and the envelope is stored durably before acknowledgement; processing happens asynchronously.',
    summary: 'Receive App Store notifications',
    tags: ['Commerce'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z
              .object({ signedPayload: z.string().min(20).max(2_000_000) })
              .strict()
              .meta({ id: 'AppStoreNotificationEnvelope' }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'The verified envelope was durably persisted.',
      },
      400: {
        description: 'The envelope is malformed or fails verification.',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description: 'Durable persistence is temporarily unavailable; Apple should retry.',
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
      { name: 'Collection' },
      { name: 'Commerce' },
    ],
    'x-stable-error-codes': [...stableApiErrorCodes],
  });
};
