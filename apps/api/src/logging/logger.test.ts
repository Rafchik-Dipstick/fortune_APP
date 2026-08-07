import { Writable } from 'node:stream';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';
import { createApiLogger } from './logger.js';

function createLogCapture(): { lines: () => string; stream: Writable } {
  const chunks: string[] = [];
  return {
    lines: () => chunks.join(''),
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    }),
  };
}

const productionEnvironment = createTestApiEnvironment({
  deploymentEnvironment: 'production',
  logLevel: 'info',
  nodeEnvironment: 'production',
});

const accessToken =
  'eyJhbGciOiJIUzI1NiIsImtpZCI6InYxIn0.eyJzdWIiOiJ1c2VyLTEiLCJzdiI6M30.c2lnbmF0dXJlLWJ5dGVz';
const signedTransaction =
  'eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlFQ0RDQ0F2Q2ciXX0.eyJ0cmFuc2FjdGlvbklkIjoiMjAwMCJ9.c2ln';
const refreshToken = 'rt_live_c8f0b1a2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60';
const databaseUrl = 'postgresql://postgres:hunter2@db.internal:5432/fortuneness';

/**
 * The Phase 13 production log-redaction gate. These run the real logger and
 * the real HTTP stack; nothing here stubs the scrubber, so a regression in
 * either layer fails the build (AC-16, AC-20).
 */
describe('production log redaction', () => {
  it('never writes credentials, signed payloads, or connection strings', () => {
    const capture = createLogCapture();
    const logger = createApiLogger(productionEnvironment, capture.stream);

    logger.info(
      {
        accessToken,
        commerce: { transactions: [{ signedTransactionInfo: signedTransaction }] },
        databaseUrl,
        nested: { deeper: { refreshToken } },
        requestId: '9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c',
      },
      'operational event',
    );

    const output = capture.lines();
    expect(output).toContain('operational event');
    expect(output).toContain('9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c');
    for (const secret of [accessToken, signedTransaction, refreshToken, databaseUrl, 'hunter2']) {
      expect(output).not.toContain(secret);
    }
  });

  it('scrubs a thrown error before it reaches the stream', () => {
    const capture = createLogCapture();
    const logger = createApiLogger(productionEnvironment, capture.stream);

    logger.error(
      { err: new Error(`could not verify ${signedTransaction}`) },
      'verification failed',
    );

    const output = capture.lines();
    expect(output).toContain('verification failed');
    expect(output).not.toContain(signedTransaction);
  });

  it('separates deployments so staging events cannot be read as production', () => {
    const capture = createLogCapture();
    createApiLogger(
      createTestApiEnvironment({ deploymentEnvironment: 'staging', logLevel: 'info' }),
      capture.stream,
    ).info('ready');

    expect(JSON.parse(capture.lines())).toMatchObject({
      deployment: 'staging',
      service: 'fortuneness-api',
    });
  });

  it('logs a completed request without its credentials, body, or private content', async () => {
    const capture = createLogCapture();
    const app = createApiApp({
      environment: productionEnvironment,
      logger: createApiLogger(productionEnvironment, capture.stream),
      readiness: new ApiReadiness(() => Promise.resolve()),
      configureRoutes: (configuredApp) => {
        configuredApp.post('/probe', (_request, response) => {
          response.status(200).json({});
        });
      },
    });

    await request(app)
      .post('/probe')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f607182')
      .send({ signedTransactions: [signedTransaction], intention: 'GUIDANCE' })
      .expect(200);

    const output = capture.lines();
    expect(output).toContain('request completed');
    expect(output).toContain('"path":"/probe"');
    expect(output).toContain('"statusCode":200');
    for (const secret of [accessToken, signedTransaction, '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f607182']) {
      expect(output).not.toContain(secret);
    }
  });

  it('logs an unhandled route failure without the material that caused it', async () => {
    const capture = createLogCapture();
    const app = createApiApp({
      environment: productionEnvironment,
      logger: createApiLogger(productionEnvironment, capture.stream),
      readiness: new ApiReadiness(() => Promise.resolve()),
      configureRoutes: (configuredApp) => {
        configuredApp.get('/explode', () => {
          throw new Error(`unexpected failure handling ${refreshToken} for ${databaseUrl}`);
        });
      },
    });

    await request(app).get('/explode').expect(500);

    const output = capture.lines();
    expect(output).toContain('unhandled request error');
    expect(output).not.toContain(refreshToken);
    expect(output).not.toContain('hunter2');
  });
});
