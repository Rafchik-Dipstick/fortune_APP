import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from './readiness.js';

const testEnvironment = createTestApiEnvironment({
  logLevel: 'silent',
});

const silentLogger = pino({ enabled: false });

describe('GET /health', () => {
  it('reports process and database readiness without dependency details', async () => {
    const readiness = new ApiReadiness(vi.fn().mockResolvedValue(undefined));
    const app = createApiApp({ environment: testEnvironment, logger: silentLogger, readiness });
    const response = await request(app).get('/health').expect(200);

    expect(response.body).toEqual({
      checks: { database: 'ready', process: 'ready' },
      status: 'ready',
    });
    expect(JSON.stringify(response.body)).not.toContain('postgresql');
  });

  it('fails readiness safely when PostgreSQL is unavailable', async () => {
    const readiness = new ApiReadiness(
      vi.fn().mockRejectedValue(new Error('secret database connection detail')),
    );
    const app = createApiApp({ environment: testEnvironment, logger: silentLogger, readiness });
    const response = await request(app).get('/health').expect(503);

    expect(response.body).toEqual({
      checks: { database: 'not_ready', process: 'ready' },
      status: 'not_ready',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('fails immediately after shutdown begins', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const readiness = new ApiReadiness(checkDatabase);
    readiness.stopAcceptingTraffic();
    const app = createApiApp({ environment: testEnvironment, logger: silentLogger, readiness });
    const response = await request(app).get('/health').expect(503);

    expect(response.body).toEqual({
      checks: { database: 'not_ready', process: 'not_ready' },
      status: 'not_ready',
    });
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it('is excluded from the global request-rate budget', async () => {
    const readiness = new ApiReadiness(vi.fn().mockResolvedValue(undefined));
    const app = createApiApp({
      environment: testEnvironment,
      logger: silentLogger,
      rateLimit: { max: 1, windowMs: 60_000 },
      readiness,
    });

    await request(app).get('/health').expect(200);
    await request(app).get('/health').expect(200);
  });
});
