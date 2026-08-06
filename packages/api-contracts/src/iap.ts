import { z } from 'zod';

import { uuidSchema } from './base.js';
import { subscriptionAllowanceSchema } from './fortune.js';

export const iapProductTypeSchema = z
  .enum(['CONSUMABLE', 'AUTO_RENEWABLE_SUBSCRIPTION'])
  .meta({ id: 'IapProductType' });

export const iapProductIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/u);

export const appleTransactionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[0-9]+$/u);

export const signedTransactionJwsSchema = z
  .string()
  .min(20)
  .max(20_000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

export const iapBenefitSchema = z
  .object({
    productId: iapProductIdSchema,
    kind: z.enum(['PACK_CREDITS', 'SUBSCRIPTION_DAILY_FORTUNES']),
    units: z.number().int().min(1).max(10),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
  })
  .strict()
  .meta({ id: 'IapBenefit' });

export const iapCatalogProductSchema = z
  .object({
    productId: iapProductIdSchema,
    productType: iapProductTypeSchema,
  })
  .strict()
  .meta({ id: 'IapCatalogProduct' });

export const iapCatalogResponseSchema = z
  .object({
    products: z.array(iapCatalogProductSchema).min(1).max(20),
    benefits: z.array(iapBenefitSchema).min(1).max(20),
    gracePeriodPolicy: z
      .object({
        enabled: z.boolean(),
        description: z.string().trim().min(1).max(500),
      })
      .strict(),
    appAccountToken: uuidSchema,
  })
  .strict()
  .superRefine((catalog, context) => {
    const productIds = new Set(catalog.products.map((product) => product.productId));
    if (productIds.size !== catalog.products.length) {
      context.addIssue({
        code: 'custom',
        path: ['products'],
        message: 'Catalog products must be unique.',
      });
    }
    if (catalog.benefits.some((benefit) => !productIds.has(benefit.productId))) {
      context.addIssue({
        code: 'custom',
        path: ['benefits'],
        message: 'Every benefit must describe an allowlisted product.',
      });
    }
  })
  .meta({ id: 'IapCatalogResponse' });

export const iapCallerStateSchema = z
  .object({
    subscription: subscriptionAllowanceSchema,
    spendablePackCredits: z.number().int().min(0),
    commerceReviewRequired: z.boolean(),
  })
  .strict()
  .meta({ id: 'IapCallerState' });

export const iapStatusResponseSchema = z
  .object({
    subscription: subscriptionAllowanceSchema,
    spendablePackCredits: z.number().int().min(0),
    commerceReviewRequired: z.boolean(),
  })
  .strict()
  .meta({ id: 'IapStatusResponse' });

export const iapTransactionRequestSchema = z
  .object({ signedTransaction: signedTransactionJwsSchema })
  .strict()
  .meta({ id: 'IapTransactionRequest' });

const acceptedDeliveryBase = {
  transactionId: appleTransactionIdSchema,
  deliveryAccepted: z.literal(true),
  safeToFinish: z.literal(true),
} as const;

export const iapTransactionResponseSchema = z
  .discriminatedUnion('disposition', [
    z
      .object({
        ...acceptedDeliveryBase,
        disposition: z.literal('APPLIED'),
        appliedNow: z.literal(true),
        callerState: iapCallerStateSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...acceptedDeliveryBase,
        disposition: z.literal('ALREADY_APPLIED'),
        appliedNow: z.literal(false),
        callerState: iapCallerStateSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...acceptedDeliveryBase,
        disposition: z.literal('DELIVERED_TO_OTHER_ACCOUNT'),
        appliedNow: z.literal(false),
      })
      .strict(),
    z
      .object({
        ...acceptedDeliveryBase,
        disposition: z.literal('OWNER_CLOSED_NO_BENEFIT'),
        appliedNow: z.literal(false),
      })
      .strict(),
  ])
  .meta({ id: 'IapTransactionResponse' });

export const iapReconcileRequestSchema = z
  .object({
    transactions: z.array(signedTransactionJwsSchema).min(1).max(100),
  })
  .strict()
  .meta({ id: 'IapReconcileRequest' });

const reconcileItemBase = {
  index: z.number().int().min(0).max(99),
} as const;

export const iapReconcileDispositionSchema = z
  .discriminatedUnion('disposition', [
    z
      .object({
        ...reconcileItemBase,
        ...acceptedDeliveryBase,
        disposition: z.literal('APPLIED'),
        appliedNow: z.literal(true),
      })
      .strict(),
    z
      .object({
        ...reconcileItemBase,
        ...acceptedDeliveryBase,
        disposition: z.literal('ALREADY_APPLIED'),
        appliedNow: z.literal(false),
      })
      .strict(),
    z
      .object({
        ...reconcileItemBase,
        ...acceptedDeliveryBase,
        disposition: z.literal('DELIVERED_TO_OTHER_ACCOUNT'),
        appliedNow: z.literal(false),
      })
      .strict(),
    z
      .object({
        ...reconcileItemBase,
        ...acceptedDeliveryBase,
        disposition: z.literal('OWNER_CLOSED_NO_BENEFIT'),
        appliedNow: z.literal(false),
      })
      .strict(),
    z
      .object({
        ...reconcileItemBase,
        transactionId: appleTransactionIdSchema.nullable(),
        deliveryAccepted: z.literal(false),
        safeToFinish: z.literal(false),
        disposition: z.literal('REJECTED'),
        errorCode: z.enum([
          'TRANSACTION_UNVERIFIED',
          'PRODUCT_NOT_ALLOWED',
          'TRANSACTION_OWNER_UNKNOWN',
          'RETRYABLE_CONFLICT',
        ]),
      })
      .strict(),
  ])
  .meta({ id: 'IapReconcileDisposition' });

export const iapReconcileResponseSchema = z
  .object({
    dispositions: z.array(iapReconcileDispositionSchema).min(1).max(100),
    callerState: iapCallerStateSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    const indexes = new Set(response.dispositions.map((disposition) => disposition.index));
    if (indexes.size !== response.dispositions.length) {
      context.addIssue({
        code: 'custom',
        path: ['dispositions'],
        message: 'Each submitted transaction must resolve to exactly one disposition.',
      });
    }
  })
  .meta({ id: 'IapReconcileResponse' });

export type AppleTransactionId = z.infer<typeof appleTransactionIdSchema>;
export type IapBenefit = z.infer<typeof iapBenefitSchema>;
export type IapCallerState = z.infer<typeof iapCallerStateSchema>;
export type IapCatalogProduct = z.infer<typeof iapCatalogProductSchema>;
export type IapCatalogResponse = z.infer<typeof iapCatalogResponseSchema>;
export type IapProductType = z.infer<typeof iapProductTypeSchema>;
export type IapReconcileDisposition = z.infer<typeof iapReconcileDispositionSchema>;
export type IapReconcileRequest = z.infer<typeof iapReconcileRequestSchema>;
export type IapReconcileResponse = z.infer<typeof iapReconcileResponseSchema>;
export type IapStatusResponse = z.infer<typeof iapStatusResponseSchema>;
export type IapTransactionRequest = z.infer<typeof iapTransactionRequestSchema>;
export type IapTransactionResponse = z.infer<typeof iapTransactionResponseSchema>;
