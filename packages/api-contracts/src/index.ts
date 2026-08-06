import { z } from 'zod';

import { uuidSchema } from './base.js';
import { noDrawsAvailableDetailsSchema, unviewedReadingPendingDetailsSchema } from './fortune.js';

export { apiVersionSchema, isoUtcDateTimeSchema, uuidSchema } from './base.js';

export const apiPaths = {
  authGameCenter: '/v1/auth/game-center',
  authLogout: '/v1/auth/logout',
  authRefresh: '/v1/auth/refresh',
  fortuneDraw: '/v1/fortunes/draw',
  fortuneState: '/v1/fortune/state',
  health: '/health',
  me: '/v1/me',
} as const;

export const stableApiErrorCodes = [
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'GAME_CENTER_REAUTH_REQUIRED',
  'GAME_CENTER_UNAVAILABLE',
  'GAME_CENTER_ID_NOT_PERSISTENT',
  'GAME_CENTER_PROOF_INVALID',
  'GAME_CENTER_PROOF_EXPIRED',
  'ACCOUNT_DELETION_PENDING',
  'ACCOUNT_PURGED',
  'NOT_FOUND',
  'NO_DRAWS_AVAILABLE',
  'UNVIEWED_READING_PENDING',
  'CONTENT_UNAVAILABLE',
  'PRODUCT_NOT_ALLOWED',
  'TRANSACTION_UNVERIFIED',
  'TRANSACTION_OWNER_UNKNOWN',
  'COMMERCE_REVIEW_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'TIME_ZONE_CHANGE_LIMITED',
  'RETRYABLE_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export const apiErrorCodeSchema = z.enum(stableApiErrorCodes);

const apiErrorBase = {
  message: z.string().min(1),
  requestId: uuidSchema,
  retryable: z.boolean(),
  sameKeyRetrySafe: z.boolean(),
} as const;

const apiErrorWithoutDetailsSchema = z
  .object({
    ...apiErrorBase,
    code: z.enum([
      'VALIDATION_FAILED',
      'AUTH_REQUIRED',
      'GAME_CENTER_REAUTH_REQUIRED',
      'GAME_CENTER_UNAVAILABLE',
      'GAME_CENTER_ID_NOT_PERSISTENT',
      'GAME_CENTER_PROOF_INVALID',
      'GAME_CENTER_PROOF_EXPIRED',
      'ACCOUNT_DELETION_PENDING',
      'ACCOUNT_PURGED',
      'NOT_FOUND',
      'CONTENT_UNAVAILABLE',
      'PRODUCT_NOT_ALLOWED',
      'TRANSACTION_UNVERIFIED',
      'TRANSACTION_OWNER_UNKNOWN',
      'COMMERCE_REVIEW_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED',
      'TIME_ZONE_CHANGE_LIMITED',
      'RETRYABLE_CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ]),
  })
  .strict();

export const apiErrorSchema = z
  .discriminatedUnion('code', [
    apiErrorWithoutDetailsSchema,
    z
      .object({
        ...apiErrorBase,
        code: z.literal('NO_DRAWS_AVAILABLE'),
        details: noDrawsAvailableDetailsSchema,
      })
      .strict(),
    z
      .object({
        ...apiErrorBase,
        code: z.literal('UNVIEWED_READING_PENDING'),
        details: unviewedReadingPendingDetailsSchema,
      })
      .strict(),
  ])
  .meta({ id: 'ApiError' });

export const apiErrorEnvelopeSchema = z
  .object({
    error: apiErrorSchema,
  })
  .strict()
  .meta({ id: 'ApiErrorEnvelope' });

export const componentReadinessSchema = z.enum(['ready', 'not_ready']);

export const healthResponseSchema = z
  .object({
    checks: z
      .object({
        database: componentReadinessSchema,
        process: componentReadinessSchema,
      })
      .strict(),
    status: componentReadinessSchema,
  })
  .strict()
  .meta({ id: 'HealthResponse' });

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export {
  accountBootstrapSchema,
  authDeviceSchema,
  authenticatedUserSchema,
  gameCenterAuthRequestSchema,
  gameCenterAuthResponseSchema,
  gameCenterProofSchema,
  gameCenterRestrictionsSchema,
  idempotencyKeySchema,
  meResponseSchema,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  sessionTokensSchema,
  userPreferencesSchema,
} from './auth.js';
export type {
  AccountBootstrap,
  AuthDevice,
  AuthenticatedUser,
  GameCenterAuthRequest,
  GameCenterAuthResponse,
  GameCenterProof,
  MeResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  SessionTokens,
} from './auth.js';

export {
  allowanceSourceSchema,
  fortuneAllowanceStateSchema,
  fortuneDrawRequestSchema,
  fortuneDrawResponseSchema,
  fortuneDrawSchema,
  fortuneIntentionSchema,
  fortuneOrientationSchema,
  fortuneStateResponseSchema,
  noDrawsAvailableDetailsSchema,
  subscriptionAllowanceSchema,
  unviewedReadingPendingDetailsSchema,
} from './fortune.js';
export type {
  AllowanceSource,
  FortuneAllowanceState,
  FortuneDraw,
  FortuneDrawRequest,
  FortuneDrawResponse,
  FortuneIntention,
  FortuneOrientation,
  FortuneStateResponse,
  NoDrawsAvailableDetails,
  SubscriptionAllowance,
  UnviewedReadingPendingDetails,
} from './fortune.js';
