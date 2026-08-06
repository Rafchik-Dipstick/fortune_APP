import { z } from 'zod';

import { isoUtcDateTimeSchema, uuidSchema } from './base.js';

export const fortuneIntentionSchema = z
  .enum(['GENERAL', 'LOVE', 'WORK', 'GROWTH'])
  .meta({ id: 'FortuneIntention' });

export const fortuneOrientationSchema = z
  .enum(['UPRIGHT', 'REVERSED'])
  .meta({ id: 'FortuneOrientation' });

export const allowanceSourceSchema = z
  .enum(['FREE_DAILY', 'SUBSCRIPTION_DAILY', 'PACK_CREDIT'])
  .meta({ id: 'AllowanceSource' });

export const subscriptionAllowanceSchema = z
  .object({
    status: z.enum(['NONE', 'ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'EXPIRED', 'REVOKED']),
    entitled: z.boolean(),
    paidThrough: isoUtcDateTimeSchema.nullable(),
    graceThrough: isoUtcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((subscription, context) => {
    const hasEntitlementBoundary =
      subscription.paidThrough !== null || subscription.graceThrough !== null;
    if (subscription.entitled && !hasEntitlementBoundary) {
      context.addIssue({
        code: 'custom',
        message: 'An entitled subscription requires a verified future boundary.',
      });
    }
    if (subscription.status === 'NONE' && hasEntitlementBoundary) {
      context.addIssue({
        code: 'custom',
        message: 'A missing subscription cannot expose entitlement boundaries.',
      });
    }
  })
  .meta({ id: 'SubscriptionAllowance' });

export const fortuneAllowanceStateSchema = z
  .object({
    serverTime: isoUtcDateTimeSchema,
    freeRemaining: z.number().int().min(0).max(1),
    subscriptionRemaining: z.number().int().min(0).max(10),
    spendablePackCredits: z.number().int().min(0),
    availableDraws: z.number().int().min(0),
    allowancePeriodId: uuidSchema,
    currentPeriodStartedAt: isoUtcDateTimeSchema,
    nextResetAt: isoUtcDateTimeSchema,
    accountTimeZone: z.string().trim().min(1).max(128),
    reportedDeviceTimeZone: z.string().trim().min(1).max(128),
    pendingTimeZone: z.string().trim().min(1).max(128).nullable(),
    timeZoneEffectiveAt: isoUtcDateTimeSchema.nullable(),
    nextTimeZoneChangeEligibleAt: isoUtcDateTimeSchema.nullable(),
    subscription: subscriptionAllowanceSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.availableDraws !==
      state.freeRemaining + state.subscriptionRemaining + state.spendablePackCredits
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableDraws'],
        message: 'Available draws must equal the authoritative allowance components.',
      });
    }
    if (new Date(state.currentPeriodStartedAt) >= new Date(state.nextResetAt)) {
      context.addIssue({
        code: 'custom',
        path: ['nextResetAt'],
        message: 'The next reset must follow the current period start.',
      });
    }
  })
  .meta({ id: 'FortuneAllowanceState' });

export const fortuneDrawSchema = z
  .object({
    id: uuidSchema,
    cardKey: z.string().trim().min(1).max(48),
    cardDisplayNumber: z.string().trim().min(1).max(16),
    cardName: z.string().trim().min(1).max(80),
    orientation: fortuneOrientationSchema,
    intention: fortuneIntentionSchema,
    resolvedLocale: z.string().trim().min(2).max(16),
    artAltText: z.string().trim().min(1).max(500),
    headline: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1_200),
    action: z.string().trim().min(1).max(500),
    affirmation: z.string().trim().min(1).max(300),
    allowanceSource: allowanceSourceSchema,
    contentVersion: z.string().trim().min(1).max(48),
    issuedAt: isoUtcDateTimeSchema,
    viewedAt: isoUtcDateTimeSchema.nullable(),
  })
  .strict()
  .meta({ id: 'FortuneDraw' });

export const fortuneStateResponseSchema = z
  .object({
    state: fortuneAllowanceStateSchema,
    unviewedDraw: fortuneDrawSchema.nullable(),
  })
  .strict()
  .meta({ id: 'FortuneStateResponse' });

export const fortuneDrawRequestSchema = z
  .object({ intention: fortuneIntentionSchema })
  .strict()
  .meta({ id: 'FortuneDrawRequest' });

export const fortuneDrawResponseSchema = z
  .object({
    draw: fortuneDrawSchema,
    state: fortuneAllowanceStateSchema,
  })
  .strict()
  .meta({ id: 'FortuneDrawResponse' });

export const noDrawsAvailableDetailsSchema = z
  .object({ state: fortuneAllowanceStateSchema })
  .strict()
  .meta({ id: 'NoDrawsAvailableDetails' });

export const unviewedReadingPendingDetailsSchema = z
  .object({
    state: fortuneAllowanceStateSchema,
    unviewedDraw: fortuneDrawSchema,
  })
  .strict()
  .meta({ id: 'UnviewedReadingPendingDetails' });

export type AllowanceSource = z.infer<typeof allowanceSourceSchema>;
export type FortuneAllowanceState = z.infer<typeof fortuneAllowanceStateSchema>;
export type FortuneDraw = z.infer<typeof fortuneDrawSchema>;
export type FortuneDrawRequest = z.infer<typeof fortuneDrawRequestSchema>;
export type FortuneDrawResponse = z.infer<typeof fortuneDrawResponseSchema>;
export type FortuneIntention = z.infer<typeof fortuneIntentionSchema>;
export type FortuneOrientation = z.infer<typeof fortuneOrientationSchema>;
export type FortuneStateResponse = z.infer<typeof fortuneStateResponseSchema>;
export type NoDrawsAvailableDetails = z.infer<typeof noDrawsAvailableDetailsSchema>;
export type SubscriptionAllowance = z.infer<typeof subscriptionAllowanceSchema>;
export type UnviewedReadingPendingDetails = z.infer<typeof unviewedReadingPendingDetailsSchema>;
