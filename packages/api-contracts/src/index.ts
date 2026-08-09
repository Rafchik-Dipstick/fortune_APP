import { z } from 'zod';

import { deletionManagementSchema, timeZoneChangeLimitedDetailsSchema } from './account.js';
import { uuidSchema } from './base.js';
import { noDrawsAvailableDetailsSchema, unviewedReadingPendingDetailsSchema } from './fortune.js';

export { apiVersionSchema, isoUtcDateTimeSchema, uuidSchema } from './base.js';

export const apiPaths = {
  authApple: '/v1/auth/apple',
  authLogout: '/v1/auth/logout',
  authRefresh: '/v1/auth/refresh',
  fortuneDraw: '/v1/fortunes/draw',
  fortunes: '/v1/fortunes',
  fortuneDetail: '/v1/fortunes/:id',
  fortuneState: '/v1/fortune/state',
  fortuneViewed: '/v1/fortunes/:id/viewed',
  collection: '/v1/collection',
  collectionCard: '/v1/collection/cards/:key',
  health: '/health',
  iapCatalog: '/v1/iap/catalog',
  iapReconcile: '/v1/iap/reconcile',
  iapStatus: '/v1/iap/status',
  iapTransactions: '/v1/iap/transactions',
  me: '/v1/me',
  mePreferences: '/v1/me/preferences',
  meDeletion: '/v1/me/deletion',
  meDeletionCancel: '/v1/me/deletion/cancel',
  meConsumptionConsent: '/v1/me/consumption-consent',
  appStoreWebhook: '/v1/webhooks/app-store',
  signInWithAppleWebhook: '/v1/webhooks/sign-in-with-apple',
} as const;

export const fortuneViewedPath = (drawId: string): string =>
  apiPaths.fortuneViewed.replace(':id', drawId);

export const fortuneDetailPath = (drawId: string): string =>
  apiPaths.fortuneDetail.replace(':id', drawId);

export const collectionCardPath = (cardKey: string): string =>
  apiPaths.collectionCard.replace(':key', cardKey);

export const stableApiErrorCodes = [
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'APPLE_ID_REAUTH_REQUIRED',
  'APPLE_ID_UNAVAILABLE',
  'APPLE_ID_TOKEN_INVALID',
  'APPLE_ID_TOKEN_EXPIRED',
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
      'APPLE_ID_REAUTH_REQUIRED',
      'APPLE_ID_UNAVAILABLE',
      'APPLE_ID_TOKEN_INVALID',
      'APPLE_ID_TOKEN_EXPIRED',
      'ACCOUNT_PURGED',
      'NOT_FOUND',
      'CONTENT_UNAVAILABLE',
      'PRODUCT_NOT_ALLOWED',
      'TRANSACTION_UNVERIFIED',
      'TRANSACTION_OWNER_UNKNOWN',
      'COMMERCE_REVIEW_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED',
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
        code: z.literal('ACCOUNT_DELETION_PENDING'),
        // Present only on the authentication path, where the client needs the
        // scoped exchange data to reach deletion status or cancellation.
        details: deletionManagementSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...apiErrorBase,
        code: z.literal('TIME_ZONE_CHANGE_LIMITED'),
        details: timeZoneChangeLimitedDetailsSchema.optional(),
      })
      .strict(),
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
  appleAuthRequestSchema,
  appleAuthResponseSchema,
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
  AppleAuthRequest,
  AppleAuthResponse,
  MeResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  SessionTokens,
  UserPreferences,
} from './auth.js';

export {
  allowanceSourceSchema,
  fortuneAllowanceStateSchema,
  fortuneDrawRequestSchema,
  fortuneDrawResponseSchema,
  fortuneDrawSchema,
  fortuneDetailResponseSchema,
  fortuneHistoryQuerySchema,
  fortuneHistoryResponseSchema,
  fortuneIntentionSchema,
  fortuneOrientationSchema,
  fortuneStateResponseSchema,
  fortuneViewedResponseSchema,
  noDrawsAvailableDetailsSchema,
  opaqueCursorSchema,
  subscriptionAllowanceSchema,
  tarotArcanaSchema,
  tarotRankSchema,
  tarotSuitSchema,
  collectionCardSchema,
  collectionCardDetailResponseSchema,
  collectionCardReadingsQuerySchema,
  collectionResponseSchema,
  unviewedReadingPendingDetailsSchema,
} from './fortune.js';
export {
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  accountDeletionStateSchema,
  accountDeletionStatusSchema,
  consumptionConsentSchema,
  consumptionConsentUpdateRequestSchema,
  deletionConfirmationVersionSchema,
  deletionManagementSchema,
  preferencesUpdateRequestSchema,
  preferencesUpdateResponseSchema,
  timeZoneChangeLimitedDetailsSchema,
  timeZoneStateSchema,
} from './account.js';
export type {
  AccountDeletionRequest,
  AccountDeletionResponse,
  AccountDeletionState,
  AccountDeletionStatus,
  ConsumptionConsent,
  ConsumptionConsentUpdateRequest,
  DeletionManagement,
  PreferencesUpdateRequest,
  PreferencesUpdateResponse,
  TimeZoneChangeLimitedDetails,
  TimeZoneState,
} from './account.js';
export {
  appleTransactionIdSchema,
  iapBenefitSchema,
  iapCallerStateSchema,
  iapCatalogProductSchema,
  iapCatalogResponseSchema,
  iapProductIdSchema,
  iapProductTypeSchema,
  iapReconcileDispositionSchema,
  iapReconcileRequestSchema,
  iapReconcileResponseSchema,
  iapStatusResponseSchema,
  iapTransactionRequestSchema,
  iapTransactionResponseSchema,
  signedTransactionJwsSchema,
} from './iap.js';
export type {
  AppleTransactionId,
  IapBenefit,
  IapCallerState,
  IapCatalogProduct,
  IapCatalogResponse,
  IapProductType,
  IapReconcileDisposition,
  IapReconcileRequest,
  IapReconcileResponse,
  IapStatusResponse,
  IapTransactionRequest,
  IapTransactionResponse,
} from './iap.js';

export type {
  AllowanceSource,
  FortuneAllowanceState,
  FortuneDraw,
  FortuneDrawRequest,
  FortuneDrawResponse,
  FortuneDetailResponse,
  FortuneHistoryQuery,
  FortuneHistoryResponse,
  FortuneIntention,
  FortuneOrientation,
  FortuneStateResponse,
  FortuneViewedResponse,
  NoDrawsAvailableDetails,
  SubscriptionAllowance,
  TarotArcana,
  TarotRank,
  TarotSuit,
  CollectionCard,
  CollectionCardDetailResponse,
  CollectionCardReadingsQuery,
  CollectionResponse,
  UnviewedReadingPendingDetails,
} from './fortune.js';
