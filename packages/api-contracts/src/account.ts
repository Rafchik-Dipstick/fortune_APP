import { z } from 'zod';

import { isoUtcDateTimeSchema } from './base.js';
import { reportedTimeZoneSchema, userPreferencesSchema } from './auth.js';

/**
 * Version of the deletion consequence summary the player was shown. The
 * server records what was actually presented, so a later change to the copy
 * cannot retroactively describe what somebody agreed to (spec section 3.6).
 */
export const deletionConfirmationVersionSchema = z.literal('2026-08-delete-v1');

export const accountDeletionStatusSchema = z
  .enum(['PENDING', 'CANCELLED', 'PURGED'])
  .meta({ id: 'AccountDeletionStatus' });

/**
 * V1 writes reminder, sound, haptic, motion, and requested time zone. Locale
 * is resolved from the reported device locale during authentication and is
 * deliberately not writable here.
 */
export const preferencesUpdateRequestSchema = z
  .object({
    reminderEnabled: z.boolean().optional(),
    reminderLocalMinutes: z.number().int().min(0).max(1_439).optional(),
    soundEnabled: z.boolean().optional(),
    hapticsEnabled: z.boolean().optional(),
    reduceMotionPreferred: z.boolean().optional(),
    requestedTimeZone: reportedTimeZoneSchema.optional(),
  })
  .strict()
  .refine((update) => Object.keys(update).length > 0, {
    message: 'A preferences update must change at least one allowlisted field.',
  })
  .meta({ id: 'PreferencesUpdateRequest' });

export const timeZoneStateSchema = z
  .object({
    accountTimeZone: reportedTimeZoneSchema,
    pendingTimeZone: reportedTimeZoneSchema.nullable(),
    timeZoneEffectiveAt: isoUtcDateTimeSchema.nullable(),
    nextTimeZoneChangeEligibleAt: isoUtcDateTimeSchema.nullable(),
  })
  .strict()
  .meta({ id: 'TimeZoneState' });

export const preferencesUpdateResponseSchema = z
  .object({
    preferences: userPreferencesSchema,
    timeZoneState: timeZoneStateSchema,
  })
  .strict()
  .meta({ id: 'PreferencesUpdateResponse' });

/**
 * Acknowledgements are separate because the Apple-billing one is required
 * only when Apple reports a subscription that may still be charged. The
 * server verifies which ones apply rather than trusting the client.
 */
export const accountDeletionRequestSchema = z
  .object({
    confirmationVersion: deletionConfirmationVersionSchema,
    acknowledgedAccessEnds: z.literal(true),
    acknowledgedDataLoss: z.literal(true),
    acknowledgedAppleBilling: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'AccountDeletionRequest' });

export const accountDeletionStateSchema = z
  .object({
    status: accountDeletionStatusSchema,
    requestedAt: isoUtcDateTimeSchema,
    purgeAt: isoUtcDateTimeSchema,
    cancelledAt: isoUtcDateTimeSchema.nullable(),
  })
  .strict()
  .meta({ id: 'AccountDeletionState' });

export const accountDeletionResponseSchema = z
  .object({ deletion: accountDeletionStateSchema })
  .strict()
  .meta({ id: 'AccountDeletionResponse' });

/**
 * Short-lived token scoped only to deletion status and cancellation. It is
 * never a normal session: reauthenticating during the processing period must
 * not silently restore application access (spec section 6.3).
 */
export const deletionManagementSchema = z
  .object({
    deletionManagementToken: z.string().min(32).max(4_096),
    expiresAt: isoUtcDateTimeSchema,
    deletion: accountDeletionStateSchema,
  })
  .strict()
  .meta({ id: 'DeletionManagement' });

export const timeZoneChangeLimitedDetailsSchema = z
  .object({
    nextEligibleAt: isoUtcDateTimeSchema,
    accountTimeZone: reportedTimeZoneSchema,
    pendingTimeZone: reportedTimeZoneSchema.nullable(),
    supportUrl: z.url(),
  })
  .strict()
  .meta({ id: 'TimeZoneChangeLimitedDetails' });

export const consumptionConsentSchema = z
  .object({
    /** Hidden entirely when the deployment flag is off. */
    available: z.boolean(),
    granted: z.boolean(),
    consentVersion: z.string().trim().min(1).max(40).nullable(),
    decidedAt: isoUtcDateTimeSchema.nullable(),
  })
  .strict()
  .meta({ id: 'ConsumptionConsent' });

export const consumptionConsentUpdateRequestSchema = z
  .object({
    granted: z.boolean(),
    consentVersion: z.string().trim().min(1).max(40),
  })
  .strict()
  .meta({ id: 'ConsumptionConsentUpdateRequest' });

export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;
export type AccountDeletionState = z.infer<typeof accountDeletionStateSchema>;
export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;
export type ConsumptionConsent = z.infer<typeof consumptionConsentSchema>;
export type ConsumptionConsentUpdateRequest = z.infer<typeof consumptionConsentUpdateRequestSchema>;
export type DeletionManagement = z.infer<typeof deletionManagementSchema>;
export type PreferencesUpdateRequest = z.infer<typeof preferencesUpdateRequestSchema>;
export type PreferencesUpdateResponse = z.infer<typeof preferencesUpdateResponseSchema>;
export type TimeZoneChangeLimitedDetails = z.infer<typeof timeZoneChangeLimitedDetailsSchema>;
export type TimeZoneState = z.infer<typeof timeZoneStateSchema>;
