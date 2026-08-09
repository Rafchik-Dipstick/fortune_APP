import { type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import { apiPaths } from '@fortuneness/api-contracts';

import { AppleIdentityNotificationError } from '../auth/apple-identity-notification.js';
import { DatabaseError } from '../db/errors.js';
import { NotificationIngestError } from '../iap/notifications.js';
import { ApiHttpError } from '../middleware/errors.js';

const appStoreEnvelopeSchema = z
  .object({ signedPayload: z.string().min(20).max(2_000_000) })
  .strict();

export interface AppStoreNotificationHandler {
  ingest(signedPayload: string): Promise<{ notificationUuid: string }>;
}

export interface AppleIdentityNotificationHandler {
  ingest(signedPayload: string): Promise<{ notificationId: string }>;
}

const appleIdentityEnvelopeSchema = z.object({ payload: z.string().min(20).max(32_768) }).strict();

/**
 * Unauthenticated App Store Server Notifications V2 receiver. Returns 200
 * only after the verified envelope is durably persisted; verification
 * failures are terminal 400s and storage failures are retryable non-2xx so
 * Apple redelivers.
 */
function createAppStoreWebhookRoute(ingest: AppStoreNotificationHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = appStoreEnvelopeSchema.safeParse(request.body);
    if (!parsed.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The notification envelope is malformed.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      await ingest.ingest(parsed.data.signedPayload);
      response.status(200).json({});
    } catch (error) {
      if (error instanceof NotificationIngestError) {
        next(
          error.code === 'NOTIFICATION_UNVERIFIED'
            ? new ApiHttpError({
                code: 'VALIDATION_FAILED',
                message: 'The notification payload failed verification.',
                statusCode: 400,
              })
            : new ApiHttpError({
                code: 'RETRYABLE_CONFLICT',
                message: 'Durable notification storage is temporarily unavailable.',
                retryable: true,
                sameKeyRetrySafe: true,
                statusCode: 503,
              }),
        );
        return;
      }
      next(error);
    }
  };
}

function createAppleIdentityWebhookRoute(ingest: AppleIdentityNotificationHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = appleIdentityEnvelopeSchema.safeParse(request.body);
    if (!parsed.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The Sign in with Apple notification envelope is malformed.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      await ingest.ingest(parsed.data.payload);
      response.status(200).json({});
    } catch (error) {
      if (error instanceof AppleIdentityNotificationError) {
        if (error.code === 'INVALID_NOTIFICATION') {
          next(
            new ApiHttpError({
              code: 'VALIDATION_FAILED',
              message: 'The Sign in with Apple notification failed verification.',
              statusCode: 400,
            }),
          );
          return;
        }
        next(
          new ApiHttpError({
            code: 'APPLE_ID_UNAVAILABLE',
            message: 'The Sign in with Apple notification cannot be processed temporarily.',
            retryable: true,
            sameKeyRetrySafe: true,
            statusCode: 503,
          }),
        );
        return;
      }
      if (error instanceof DatabaseError && error.retryable) {
        next(
          new ApiHttpError({
            code: 'RETRYABLE_CONFLICT',
            message: 'Durable notification processing is temporarily unavailable.',
            retryable: true,
            sameKeyRetrySafe: true,
            statusCode: 503,
          }),
        );
        return;
      }
      next(error);
    }
  };
}

export function registerWebhookRoutes(
  app: Express,
  handlers: {
    appStoreNotifications: AppStoreNotificationHandler;
    appleIdentityNotifications: AppleIdentityNotificationHandler;
  },
): void {
  app.post(apiPaths.appStoreWebhook, createAppStoreWebhookRoute(handlers.appStoreNotifications));
  app.post(
    apiPaths.signInWithAppleWebhook,
    createAppleIdentityWebhookRoute(handlers.appleIdentityNotifications),
  );
}
