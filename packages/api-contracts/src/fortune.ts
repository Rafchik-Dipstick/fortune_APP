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

export const fortuneViewedResponseSchema = z
  .object({ draw: fortuneDrawSchema })
  .strict()
  .meta({ id: 'FortuneViewedResponse' });

export const tarotArcanaSchema = z.enum(['MAJOR', 'MINOR']).meta({ id: 'TarotArcana' });
export const tarotSuitSchema = z
  .enum(['WANDS', 'CUPS', 'SWORDS', 'PENTACLES'])
  .meta({ id: 'TarotSuit' });
export const tarotRankSchema = z
  .enum([
    'ACE',
    'TWO',
    'THREE',
    'FOUR',
    'FIVE',
    'SIX',
    'SEVEN',
    'EIGHT',
    'NINE',
    'TEN',
    'PAGE',
    'KNIGHT',
    'QUEEN',
    'KING',
  ])
  .meta({ id: 'TarotRank' });

export const opaqueCursorSchema = z
  .string()
  .min(16)
  .max(1_024)
  .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

const paginationLimitSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value),
  z.number().int().min(1).max(100).default(30),
);

export const collectionCardReadingsQuerySchema = z
  .object({
    cursor: opaqueCursorSchema.optional(),
    limit: paginationLimitSchema,
  })
  .strict()
  .meta({ id: 'CollectionCardReadingsQuery' });

export const fortuneHistoryQuerySchema = z
  .object({
    cursor: opaqueCursorSchema.optional(),
    limit: paginationLimitSchema,
    cardKey: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .optional(),
    arcana: tarotArcanaSchema.optional(),
    suit: tarotSuitSchema.optional(),
    orientation: fortuneOrientationSchema.optional(),
    intention: fortuneIntentionSchema.optional(),
    issuedFrom: isoUtcDateTimeSchema.optional(),
    issuedTo: isoUtcDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.issuedFrom !== undefined &&
      query.issuedTo !== undefined &&
      new Date(query.issuedFrom) > new Date(query.issuedTo)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['issuedTo'],
        message: 'The end of the reading range must not precede its start.',
      });
    }
  })
  .meta({ id: 'FortuneHistoryQuery' });

export const fortuneHistoryResponseSchema = z
  .object({
    items: z.array(fortuneDrawSchema).max(100),
    nextCursor: opaqueCursorSchema.nullable(),
    syncedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .meta({ id: 'FortuneHistoryResponse' });

export const fortuneDetailResponseSchema = z
  .object({ draw: fortuneDrawSchema })
  .strict()
  .meta({ id: 'FortuneDetailResponse' });

export const collectionCardSchema = z
  .object({
    key: z.string().trim().min(1).max(48),
    displayNumber: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(80),
    arcana: tarotArcanaSchema,
    suit: tarotSuitSchema.nullable(),
    rank: tarotRankSchema.nullable(),
    artAltText: z.string().trim().min(1).max(500),
    sortOrder: z.number().int().min(0).max(77),
    unlocked: z.boolean(),
    readingCount: z.number().int().min(0),
    firstDiscoveredAt: isoUtcDateTimeSchema.nullable(),
    latestReadingAt: isoUtcDateTimeSchema.nullable(),
    uprightDiscoveredAt: isoUtcDateTimeSchema.nullable(),
    reversedDiscoveredAt: isoUtcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((card, context) => {
    const hasDiscovery = card.firstDiscoveredAt !== null && card.latestReadingAt !== null;
    if (card.unlocked !== card.readingCount > 0 || card.unlocked !== hasDiscovery) {
      context.addIssue({
        code: 'custom',
        message: 'Collection unlock state must match its reading count and discovery dates.',
      });
    }
    if (
      card.firstDiscoveredAt !== null &&
      card.latestReadingAt !== null &&
      new Date(card.firstDiscoveredAt) > new Date(card.latestReadingAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latestReadingAt'],
        message: 'Latest reading cannot precede first discovery.',
      });
    }
  })
  .meta({ id: 'CollectionCard' });

export const collectionResponseSchema = z
  .object({
    cards: z.array(collectionCardSchema).length(78),
    unlockedCount: z.number().int().min(0).max(78),
    totalCount: z.literal(78),
    syncedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .superRefine((collection, context) => {
    const unlocked = collection.cards.filter((card) => card.unlocked).length;
    if (unlocked !== collection.unlockedCount) {
      context.addIssue({
        code: 'custom',
        path: ['unlockedCount'],
        message: 'Unlocked count must match the collection card states.',
      });
    }
    const keys = new Set(collection.cards.map((card) => card.key));
    const sortOrders = new Set(collection.cards.map((card) => card.sortOrder));
    if (keys.size !== 78 || sortOrders.size !== 78) {
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: 'The canonical collection must contain 78 unique keys and sort orders.',
      });
    }
  })
  .meta({ id: 'CollectionResponse' });

export const collectionCardDetailResponseSchema = z
  .object({
    card: collectionCardSchema,
    readings: z.array(fortuneDrawSchema).max(100),
    nextCursor: opaqueCursorSchema.nullable(),
    syncedAt: isoUtcDateTimeSchema,
  })
  .strict()
  .meta({ id: 'CollectionCardDetailResponse' });

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
export type FortuneDetailResponse = z.infer<typeof fortuneDetailResponseSchema>;
export type FortuneHistoryQuery = z.infer<typeof fortuneHistoryQuerySchema>;
export type FortuneHistoryResponse = z.infer<typeof fortuneHistoryResponseSchema>;
export type FortuneIntention = z.infer<typeof fortuneIntentionSchema>;
export type FortuneOrientation = z.infer<typeof fortuneOrientationSchema>;
export type FortuneStateResponse = z.infer<typeof fortuneStateResponseSchema>;
export type FortuneViewedResponse = z.infer<typeof fortuneViewedResponseSchema>;
export type NoDrawsAvailableDetails = z.infer<typeof noDrawsAvailableDetailsSchema>;
export type SubscriptionAllowance = z.infer<typeof subscriptionAllowanceSchema>;
export type UnviewedReadingPendingDetails = z.infer<typeof unviewedReadingPendingDetailsSchema>;
export type TarotArcana = z.infer<typeof tarotArcanaSchema>;
export type TarotRank = z.infer<typeof tarotRankSchema>;
export type TarotSuit = z.infer<typeof tarotSuitSchema>;
export type CollectionCard = z.infer<typeof collectionCardSchema>;
export type CollectionCardDetailResponse = z.infer<typeof collectionCardDetailResponseSchema>;
export type CollectionCardReadingsQuery = z.infer<typeof collectionCardReadingsQuerySchema>;
export type CollectionResponse = z.infer<typeof collectionResponseSchema>;
