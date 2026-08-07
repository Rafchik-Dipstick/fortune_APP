import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { type EgressRequest, type EgressResponse } from '../security/egress.js';
import { NoopErrorReporter, SentryErrorReporter, createErrorReporter } from './error-reporter.js';

const silentLogger = pino({ enabled: false });

const target = {
  envelopeUrl: 'https://o1.ingest.example.com/api/42/envelope/',
  host: 'o1.ingest.example.com',
  projectId: '42',
  publicKey: 'abc123publickey',
};

const signedTransaction =
  'eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlFQ0RDQ0F2Q2ciXX0.eyJ0cmFuc2FjdGlvbklkIjoiMjAwMCJ9.c2ln';

function createReporter(
  overrides: {
    now?: () => number;
    send?: (options: EgressRequest) => Promise<EgressResponse>;
  } = {},
) {
  const send = vi.fn<(options: EgressRequest) => Promise<EgressResponse>>(
    overrides.send ??
      (() => Promise.resolve({ body: Buffer.alloc(0), headers: {}, statusCode: 200 })),
  );
  const reporter = new SentryErrorReporter({
    deploymentEnvironment: 'staging',
    logger: silentLogger,
    release: 'fortuneness-api@1.2.3',
    send,
    target,
    timeoutMs: 4_000,
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  });
  return { reporter, send };
}

function parseEnvelope(body: unknown): {
  event: Record<string, unknown>;
  header: Record<string, unknown>;
} {
  const [header, , event] = String(body).split('\n');
  return {
    event: JSON.parse(event ?? '{}') as Record<string, unknown>,
    header: JSON.parse(header ?? '{}') as Record<string, unknown>,
  };
}

describe('error reporting', () => {
  it('sends only to the DSN host, through the egress guard', async () => {
    const { reporter, send } = createReporter();
    reporter.capture(new Error('boom'), { operation: 'POST /v1/fortunes/draw', source: 'request' });
    await reporter.flush();

    const call = send.mock.calls[0]?.[0];
    expect(call?.allowedHosts).toEqual(['o1.ingest.example.com']);
    expect(call?.url).toBe('https://o1.ingest.example.com/api/42/envelope/');
    expect(call?.method).toBe('POST');
    expect(call?.timeoutMs).toBe(4_000);
    expect(call?.headers?.['X-Sentry-Auth']).toContain('sentry_key=abc123publickey');
  });

  it('tags the deployment environment so streams cannot be confused', async () => {
    const { reporter, send } = createReporter();
    reporter.capture(new Error('boom'), { source: 'job', operation: 'app-store-reconciliation' });
    await reporter.flush();

    const { event } = parseEnvelope(send.mock.calls[0]?.[0].body);
    expect(event['environment']).toBe('staging');
    expect(event['release']).toBe('fortuneness-api@1.2.3');
    expect(event['tags']).toMatchObject({
      operation: 'app-store-reconciliation',
      source: 'job',
    });
  });

  it('scrubs signed Apple material out of the reported message and stack', async () => {
    const { reporter, send } = createReporter();
    reporter.capture(new Error(`verification failed for ${signedTransaction}`), {
      requestId: '9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c',
      source: 'request',
    });
    await reporter.flush();

    const body = String(send.mock.calls[0]?.[0].body);
    expect(body).not.toContain(signedTransaction);
    expect(body).toContain('9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c');
  });

  it('reports no player identity, request body, or headers', async () => {
    const { reporter, send } = createReporter();
    reporter.capture(new Error('boom'), { source: 'request' });
    await reporter.flush();

    const { event } = parseEnvelope(send.mock.calls[0]?.[0].body);
    expect(event['user']).toBeUndefined();
    expect(event['request']).toBeUndefined();
    expect(event['server_name']).toBeUndefined();
    expect(event['breadcrumbs']).toBeUndefined();
  });

  it('accepts a thrown non-error without crashing the caller', async () => {
    const { reporter, send } = createReporter();
    reporter.capture('a bare string failure', { source: 'process' });
    reporter.capture(undefined, { source: 'process' });
    await reporter.flush();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('caps the per-minute volume so an error storm cannot become an egress storm', async () => {
    let nowMs = 1_800_000_000_000;
    const { reporter, send } = createReporter({ now: () => nowMs });

    for (let index = 0; index < 50; index += 1) {
      reporter.capture(new Error(`failure ${String(index)}`), { source: 'request' });
    }
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(30);

    nowMs += 60_000;
    reporter.capture(new Error('next minute'), { source: 'request' });
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(31);
  });

  it('never lets a delivery failure escape into the caller', async () => {
    const { reporter, send } = createReporter({
      send: () => Promise.reject(new Error('ingest unreachable')),
    });

    expect(() => {
      reporter.capture(new Error('boom'), { source: 'request' });
    }).not.toThrow();
    await expect(reporter.flush()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports nothing at all from a local run', () => {
    const environment = createTestApiEnvironment({
      deploymentEnvironment: 'local',
      observability: {
        errorReporting: target,
        metricsFlushIntervalMs: 60_000,
        release: null,
      },
    });

    expect(createErrorReporter(environment, silentLogger)).toBeInstanceOf(NoopErrorReporter);
  });

  it('reports nothing when no DSN is configured', () => {
    const environment = createTestApiEnvironment({ deploymentEnvironment: 'staging' });

    expect(createErrorReporter(environment, silentLogger)).toBeInstanceOf(NoopErrorReporter);
  });

  it('builds a real reporter for a configured deployment', () => {
    const environment = createTestApiEnvironment({
      deploymentEnvironment: 'production',
      observability: {
        errorReporting: target,
        metricsFlushIntervalMs: 60_000,
        release: 'r1',
      },
    });

    expect(createErrorReporter(environment, silentLogger)).toBeInstanceOf(SentryErrorReporter);
  });
});
