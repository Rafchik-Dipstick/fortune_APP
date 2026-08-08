import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiPaths } from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';
import { resolveRateLimitTier } from './rate-limits.js';

const silentLogger = pino({ enabled: false });

const createTieredApp = () => {
  const environment = createTestApiEnvironment({
    logLevel: 'silent',
    rateLimits: {
      authenticationMax: 2,
      defaultMax: 5,
      drawMax: 3,
      webhookMax: 8,
      windowMs: 60_000,
    },
  });

  return createApiApp({
    environment,
    logger: silentLogger,
    readiness: new ApiReadiness(() => Promise.resolve()),
    configureRoutes: (app) => {
      for (const path of [
        apiPaths.authRefresh,
        apiPaths.fortuneDraw,
        apiPaths.fortuneState,
        apiPaths.appStoreWebhook,
      ]) {
        app.all(path, (_request, response) => {
          response.status(200).json({});
        });
      }
    },
  });
};

describe('tiered rate limits', () => {
  it.each([
    [apiPaths.authApple, 'authentication'],
    [apiPaths.authRefresh, 'authentication'],
    [apiPaths.authLogout, 'authentication'],
    [apiPaths.fortuneDraw, 'draw'],
    [apiPaths.appStoreWebhook, 'webhook'],
    [apiPaths.fortuneState, 'default'],
    [apiPaths.collection, 'default'],
    [apiPaths.iapTransactions, 'default'],
  ])('assigns %s to the %s tier', (path, tier) => {
    expect(resolveRateLimitTier(path)).toBe(tier);
  });

  it('exhausts the authentication tier without touching the draw tier', async () => {
    const app = createTieredApp();

    await request(app).post(apiPaths.authRefresh).expect(200);
    await request(app).post(apiPaths.authRefresh).expect(200);
    const limited = await request(app).post(apiPaths.authRefresh).expect(429);

    expect(limited.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      sameKeyRetrySafe: true,
    });

    await request(app).post(apiPaths.fortuneDraw).expect(200);
  });

  it('gives the Apple webhook a budget a client cannot consume', async () => {
    const app = createTieredApp();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await request(app).post(apiPaths.appStoreWebhook).expect(200);
    }
    await request(app).get(apiPaths.fortuneState).expect(200);
  });

  it('never rate-limits the health probe', async () => {
    const app = createTieredApp();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app).get(apiPaths.health).expect(200);
    }
  });

  it('publishes standard rate-limit headers without legacy duplicates', async () => {
    const response = await request(createTieredApp()).post(apiPaths.fortuneDraw).expect(200);

    expect(response.headers['ratelimit']).toBeDefined();
    expect(response.headers['ratelimit-policy']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
