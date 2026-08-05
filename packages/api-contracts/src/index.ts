import { z } from 'zod';

export const apiVersionSchema = z.literal('v1');
export const uuidSchema = z.uuid();
export const isoUtcDateTimeSchema = z.iso.datetime({ offset: true });

export const apiErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: uuidSchema,
    retryable: z.boolean(),
    sameKeyRetrySafe: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const apiErrorEnvelopeSchema = z
  .object({
    error: apiErrorSchema,
  })
  .strict();

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
