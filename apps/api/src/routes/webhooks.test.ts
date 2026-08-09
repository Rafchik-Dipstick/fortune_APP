import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { apiPaths } from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { AppleIdentityNotificationError } from '../auth/apple-identity-notification.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';
import { registerWebhookRoutes } from './webhooks.js';

const silentLogger = pino({ enabled: false });

function createWebhookApp(appleIngest: (payload: string) => Promise<{ notificationId: string }>) {
  return createApiApp({
    environment: createTestApiEnvironment({ logLevel: 'silent' }),
    logger: silentLogger,
    readiness: new ApiReadiness(() => Promise.resolve()),
    configureRoutes: (app) => {
      registerWebhookRoutes(app, {
        appleIdentityNotifications: { ingest: appleIngest },
        appStoreNotifications: {
          ingest: () => Promise.resolve({ notificationUuid: 'notification-1' }),
        },
      });
    },
  });
}

describe('Sign in with Apple webhook route', () => {
  it('acknowledges only after the verified event handler completes', async () => {
    const ingest = vi.fn(() => Promise.resolve({ notificationId: 'notification-1' }));
    await request(createWebhookApp(ingest))
      .post(apiPaths.signInWithAppleWebhook)
      .send({ payload: 'headerpayload.headerpayload.signaturepart' })
      .expect(200, {});
    expect(ingest).toHaveBeenCalledWith('headerpayload.headerpayload.signaturepart');
  });

  it('rejects malformed and unverified envelopes', async () => {
    await request(createWebhookApp(() => Promise.resolve({ notificationId: 'unused' })))
      .post(apiPaths.signInWithAppleWebhook)
      .send({ payload: 'short' })
      .expect(400);

    await request(
      createWebhookApp(() =>
        Promise.reject(new AppleIdentityNotificationError('INVALID_NOTIFICATION')),
      ),
    )
      .post(apiPaths.signInWithAppleWebhook)
      .send({ payload: 'headerpayload.headerpayload.signaturepart' })
      .expect(400);
  });

  it('asks Apple to retry when its signing keys are temporarily unavailable', async () => {
    const response = await request(
      createWebhookApp(() => Promise.reject(new AppleIdentityNotificationError('KEY_UNAVAILABLE'))),
    )
      .post(apiPaths.signInWithAppleWebhook)
      .send({ payload: 'headerpayload.headerpayload.signaturepart' })
      .expect(503);
    expect(response.body.error).toMatchObject({
      code: 'APPLE_ID_UNAVAILABLE',
      retryable: true,
      sameKeyRetrySafe: true,
    });
  });
});
