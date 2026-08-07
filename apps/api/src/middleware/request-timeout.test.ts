import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';

const silentLogger = pino({ enabled: false });

const createApp = (
  configureRoutes: NonNullable<Parameters<typeof createApiApp>[0]['configureRoutes']>,
) =>
  createApiApp({
    configureRoutes,
    environment: createTestApiEnvironment({
      logLevel: 'silent',
      requestTimeoutMs: 1_000,
    }),
    logger: silentLogger,
    readiness: new ApiReadiness(() => Promise.resolve()),
  });

describe('request deadline', () => {
  it('returns the retryable envelope when a handler never responds', async () => {
    const app = createApp((configuredApp) => {
      configuredApp.get('/stalled', () => {
        // Deliberately never responds.
      });
    });

    const response = await request(app).get('/stalled').expect(503);

    expect(response.body.error).toMatchObject({
      code: 'RETRYABLE_CONFLICT',
      retryable: true,
      sameKeyRetrySafe: true,
    });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('leaves a handler that answers in time completely alone', async () => {
    const app = createApp((configuredApp) => {
      configuredApp.get('/prompt', (_request, response) => {
        response.status(200).json({ ok: true });
      });
    });

    await request(app).get('/prompt').expect(200, { ok: true });
  });

  it('does not write a second response when the handler answers late', async () => {
    let respondLate: (() => void) | undefined;
    const app = createApp((configuredApp) => {
      configuredApp.get('/slow', (_request, response) => {
        respondLate = () => {
          if (!response.headersSent) {
            response.status(200).json({ ok: true });
          }
        };
      });
    });

    await request(app).get('/slow').expect(503);
    expect(() => respondLate?.()).not.toThrow();
  });
});
