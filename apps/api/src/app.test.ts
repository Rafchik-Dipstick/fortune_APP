import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';
import { type ApiEnvironment } from './config/environment.js';
import { ApiReadiness } from './health/readiness.js';

const testEnvironment: ApiEnvironment = {
  corsOrigins: ['https://preview.fortuneness.app'],
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fortuneness',
  logLevel: 'silent',
  nodeEnvironment: 'test',
  port: 3000,
  trustProxyHops: 0,
};

const silentLogger = pino({ enabled: false });
const readyReadiness = new ApiReadiness(async () => Promise.resolve());

const createTestApp = (
  options: Omit<Parameters<typeof createApiApp>[0], 'environment' | 'logger' | 'readiness'> = {},
) =>
  createApiApp({
    ...options,
    environment: testEnvironment,
    logger: silentLogger,
    readiness: readyReadiness,
  });

describe('createApiApp', () => {
  it('creates isolated applications without opening a listener', async () => {
    const firstApp = createTestApp({
      configureRoutes: (app) => {
        app.get('/factory-probe', (_request, response) => {
          response.status(204).end();
        });
      },
    });
    const secondApp = createTestApp();

    expect(firstApp).not.toBe(secondApp);
    await request(firstApp).get('/factory-probe').expect(204);
    await request(secondApp).get('/factory-probe').expect(404);
  });

  it('sets security headers and a server-owned request ID', async () => {
    const app = createTestApp();
    const response = await request(app)
      .get('/missing')
      .set('X-Request-ID', 'not-a-uuid')
      .expect(404);

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('keeps a valid caller request ID for end-to-end correlation', async () => {
    const app = createTestApp();
    const requestId = randomUUID();
    const response = await request(app).get('/missing').set('X-Request-ID', requestId).expect(404);

    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body.error.requestId).toBe(requestId);
  });

  it('allows only configured browser origins', async () => {
    const app = createTestApp();
    const allowedResponse = await request(app)
      .options('/missing')
      .set('Origin', 'https://preview.fortuneness.app')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(allowedResponse.headers['access-control-allow-origin']).toBe(
      'https://preview.fortuneness.app',
    );

    const deniedResponse = await request(app)
      .get('/missing')
      .set('Origin', 'https://untrusted.example')
      .expect(400);

    expect(deniedResponse.headers['access-control-allow-origin']).toBeUndefined();
    expect(deniedResponse.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('normalizes malformed and oversized JSON errors', async () => {
    const app = createTestApp();
    const malformedResponse = await request(app)
      .post('/missing')
      .set('Content-Type', 'application/json')
      .send('{"broken"')
      .expect(400);
    const oversizedResponse = await request(app)
      .post('/missing')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ value: 'x'.repeat(33 * 1024) }))
      .expect(400);

    expect(malformedResponse.body.error.code).toBe('VALIDATION_FAILED');
    expect(oversizedResponse.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns the normalized envelope when the global rate limit is exceeded', async () => {
    const app = createTestApp({
      rateLimit: { max: 1, windowMs: 60_000 },
    });

    await request(app).get('/missing').expect(404);
    const response = await request(app).get('/missing').expect(429);

    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(response.body.error.retryable).toBe(true);
    expect(response.headers['ratelimit']).toBeDefined();
  });

  it('hides unexpected errors behind a safe response', async () => {
    const app = createTestApp({
      configureRoutes: (configuredApp) => {
        configuredApp.get('/explode', () => {
          throw new Error('database password must never reach the client');
        });
      },
    });
    const response = await request(app).get('/explode').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).not.toContain('password');
  });
});
