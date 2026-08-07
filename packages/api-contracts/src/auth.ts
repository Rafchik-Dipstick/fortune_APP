import { z } from 'zod';

import { isoUtcDateTimeSchema, uuidSchema } from './base.js';

const unsignedIntegerStringSchema = z
  .string()
  .regex(/^\d{1,20}$/u)
  .refine((value) => BigInt(value) <= 18_446_744_073_709_551_615n, {
    message: 'must fit an unsigned 64-bit integer',
  });

const base64FieldSchema = z
  .string()
  .min(4)
  .max(8_192)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

const reportedLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);

export const reportedTimeZoneSchema = z.string().trim().min(1).max(128);

export const idempotencyKeySchema = uuidSchema;

export const gameCenterProofSchema = z
  .object({
    teamPlayerId: z.string().trim().min(1).max(256),
    gamePlayerId: z.string().trim().min(1).max(256),
    bundleId: z
      .string()
      .trim()
      .min(3)
      .max(255)
      .regex(/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/u),
    publicKeyUrl: z
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === 'https:', {
        message: 'must use HTTPS',
      }),
    signatureBase64: base64FieldSchema,
    saltBase64: base64FieldSchema,
    timestamp: unsignedIntegerStringSchema,
  })
  .strict()
  .meta({ id: 'GameCenterProof' });

export const gameCenterRestrictionsSchema = z
  .object({
    isUnderage: z.boolean(),
    isMultiplayerGamingRestricted: z.boolean(),
    isPersonalizedCommunicationRestricted: z.boolean(),
  })
  .strict()
  .meta({ id: 'GameCenterRestrictions' });

export const authDeviceSchema = z
  .object({
    id: uuidSchema,
    description: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .meta({ id: 'AuthDevice' });

export const gameCenterAuthRequestSchema = z
  .object({
    proof: gameCenterProofSchema,
    scopedIdsPersistent: z.boolean(),
    alias: z.string().trim().min(1).max(128),
    restrictions: gameCenterRestrictionsSchema,
    reportedDeviceLocale: reportedLocaleSchema,
    reportedDeviceTimeZone: reportedTimeZoneSchema,
    device: authDeviceSchema,
  })
  .strict()
  .meta({ id: 'GameCenterAuthRequest' });

export const refreshSessionRequestSchema = z
  .object({
    refreshToken: z.string().min(32).max(512),
    device: authDeviceSchema,
  })
  .strict()
  .meta({ id: 'RefreshSessionRequest' });

export const userPreferencesSchema = z
  .object({
    reminderEnabled: z.boolean(),
    reminderLocalMinutes: z.number().int().min(0).max(1_439),
    soundEnabled: z.boolean(),
    hapticsEnabled: z.boolean(),
    reduceMotionPreferred: z.boolean(),
  })
  .strict()
  .meta({ id: 'UserPreferences' });

export const authenticatedUserSchema = z
  .object({
    id: uuidSchema,
    status: z.enum(['ACTIVE', 'DELETION_PENDING', 'PURGED', 'BLOCKED']),
    resolvedLocale: z.literal('en'),
    accountTimeZone: reportedTimeZoneSchema,
    pendingTimeZone: reportedTimeZoneSchema.nullable(),
    timeZoneEffectiveAt: isoUtcDateTimeSchema.nullable(),
    nextTimeZoneChangeEligibleAt: isoUtcDateTimeSchema.nullable(),
    onboardingCompletedAt: isoUtcDateTimeSchema.nullable(),
    preferences: userPreferencesSchema,
  })
  .strict()
  .meta({ id: 'AuthenticatedUser' });

export const sessionTokensSchema = z
  .object({
    accessToken: z.string().min(32).max(4_096),
    refreshToken: z.string().min(32).max(512),
    accessTokenExpiresAt: isoUtcDateTimeSchema,
    refreshTokenExpiresAt: isoUtcDateTimeSchema,
    authTime: isoUtcDateTimeSchema,
  })
  .strict()
  .meta({ id: 'SessionTokens' });

export const accountBootstrapSchema = z
  .object({
    serverTime: isoUtcDateTimeSchema,
    reportedDeviceLocale: reportedLocaleSchema,
    reportedDeviceTimeZone: reportedTimeZoneSchema,
    appAccountToken: uuidSchema,
  })
  .strict()
  .meta({ id: 'AccountBootstrap' });

export const gameCenterAuthResponseSchema = z
  .object({
    user: authenticatedUserSchema,
    session: sessionTokensSchema,
    bootstrap: accountBootstrapSchema,
  })
  .strict()
  .meta({ id: 'GameCenterAuthResponse' });

export const refreshSessionResponseSchema = z
  .object({ session: sessionTokensSchema })
  .strict()
  .meta({ id: 'RefreshSessionResponse' });

export const meResponseSchema = z
  .object({
    user: authenticatedUserSchema,
    bootstrap: accountBootstrapSchema,
  })
  .strict()
  .meta({ id: 'MeResponse' });

export type AccountBootstrap = z.infer<typeof accountBootstrapSchema>;
export type AuthDevice = z.infer<typeof authDeviceSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type GameCenterAuthRequest = z.infer<typeof gameCenterAuthRequestSchema>;
export type GameCenterAuthResponse = z.infer<typeof gameCenterAuthResponseSchema>;
export type GameCenterProof = z.infer<typeof gameCenterProofSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;
export type RefreshSessionResponse = z.infer<typeof refreshSessionResponseSchema>;
export type SessionTokens = z.infer<typeof sessionTokensSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
