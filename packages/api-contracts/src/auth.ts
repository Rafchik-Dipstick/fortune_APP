import { z } from 'zod';

import { isoUtcDateTimeSchema, uuidSchema } from './base.js';

const reportedLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);

export const reportedTimeZoneSchema = z.string().trim().min(1).max(128);

export const idempotencyKeySchema = uuidSchema;

export const authDeviceSchema = z
  .object({
    id: uuidSchema,
    description: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .meta({ id: 'AuthDevice' });

export const appleAuthRequestSchema = z
  .object({
    identityToken: z
      .string()
      .min(20)
      .max(16_384)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
    nonce: uuidSchema,
    reportedDeviceLocale: reportedLocaleSchema,
    reportedDeviceTimeZone: reportedTimeZoneSchema,
    device: authDeviceSchema,
  })
  .strict()
  .meta({ id: 'AppleAuthRequest' });

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

export const appleAuthResponseSchema = z
  .object({
    user: authenticatedUserSchema,
    session: sessionTokensSchema,
    bootstrap: accountBootstrapSchema,
  })
  .strict()
  .meta({ id: 'AppleAuthResponse' });

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
export type AppleAuthRequest = z.infer<typeof appleAuthRequestSchema>;
export type AppleAuthResponse = z.infer<typeof appleAuthResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;
export type RefreshSessionResponse = z.infer<typeof refreshSessionResponseSchema>;
export type SessionTokens = z.infer<typeof sessionTokensSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
