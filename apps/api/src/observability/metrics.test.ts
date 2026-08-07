import pino from 'pino';
import { describe, expect, it } from 'vitest';

import {
  LatencyHistogram,
  MetricsRegistry,
  RollingFailureRatio,
  operationalThresholds,
} from './metrics.js';

const silentLogger = pino({ enabled: false });

function createClock(startMs: number): {
  advanceMinutes: (count: number) => void;
  now: () => number;
} {
  let current = startMs;
  return {
    advanceMinutes: (count) => {
      current += count * 60_000;
    },
    now: () => current,
  };
}

describe('latency histogram', () => {
  it('reports zeroes before anything is recorded', () => {
    expect(new LatencyHistogram().snapshot()).toEqual({
      count: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    });
  });

  it('reports a bucket upper bound so a quantile never flatters the service', () => {
    const histogram = new LatencyHistogram();
    for (let index = 0; index < 99; index += 1) {
      histogram.record(30);
    }
    histogram.record(4_000);

    const snapshot = histogram.snapshot();
    expect(snapshot.count).toBe(100);
    expect(snapshot.p50Ms).toBe(50);
    expect(snapshot.p95Ms).toBe(50);
    expect(snapshot.p99Ms).toBe(50);
    expect(snapshot.maxMs).toBe(4_000);
  });

  it('places a value above the largest bucket at the observed maximum', () => {
    const histogram = new LatencyHistogram();
    histogram.record(45_000);

    expect(histogram.snapshot()).toMatchObject({ count: 1, maxMs: 45_000, p95Ms: 45_000 });
  });

  it('clears counts on reset', () => {
    const histogram = new LatencyHistogram();
    histogram.record(100);
    histogram.reset();

    expect(histogram.snapshot().count).toBe(0);
  });
});

describe('rolling failure ratio', () => {
  it('reports the ratio across the whole window', () => {
    const clock = createClock(1_800_000_000_000);
    const ratio = new RollingFailureRatio(5);

    for (let index = 0; index < 99; index += 1) {
      ratio.record(clock.now(), false);
    }
    ratio.record(clock.now(), true);

    expect(ratio.snapshot(clock.now())).toEqual({ failed: 1, ratio: 0.01, total: 100 });
  });

  it('forgets minutes that fall out of the window', () => {
    const clock = createClock(1_800_000_000_000);
    const ratio = new RollingFailureRatio(5);
    ratio.record(clock.now(), true);

    clock.advanceMinutes(5);
    expect(ratio.snapshot(clock.now())).toEqual({ failed: 0, ratio: 0, total: 0 });
  });

  it('reports a zero ratio rather than dividing by zero', () => {
    expect(new RollingFailureRatio(5).snapshot(0)).toEqual({ failed: 0, ratio: 0, total: 0 });
  });
});

describe('metrics registry', () => {
  it('keys route latency by pattern and never by a resolved identifier', () => {
    const registry = new MetricsRegistry();
    registry.recordRoute({
      durationMs: 120,
      method: 'GET',
      route: '/v1/fortunes/:id',
      statusCode: 200,
    });

    expect(Object.keys(registry.snapshot().routes)).toEqual(['GET /v1/fortunes/:id']);
  });

  it('raises the halt-rollout alert when five-minute 5xx exceeds the threshold', () => {
    const clock = createClock(1_800_000_000_000);
    const registry = new MetricsRegistry({ now: clock.now });

    for (let index = 0; index < 90; index += 1) {
      registry.recordRoute({ durationMs: 10, method: 'GET', route: '/v1/me', statusCode: 200 });
    }
    for (let index = 0; index < 10; index += 1) {
      registry.recordRoute({ durationMs: 10, method: 'GET', route: '/v1/me', statusCode: 500 });
    }

    const snapshot = registry.snapshot();
    expect(snapshot.serverErrors.ratio).toBeGreaterThan(operationalThresholds.haltServerErrorRatio);
    expect(snapshot.alerts.map((entry) => entry.alert)).toContain('SERVER_ERROR_RATE_HIGH');
  });

  it('stays quiet while the error rate is inside the threshold', () => {
    const registry = new MetricsRegistry();
    for (let index = 0; index < 200; index += 1) {
      registry.recordRoute({ durationMs: 10, method: 'GET', route: '/v1/me', statusCode: 200 });
    }
    registry.recordRoute({ durationMs: 10, method: 'GET', route: '/v1/me', statusCode: 500 });

    expect(registry.snapshot().alerts).toEqual([]);
  });

  it('applies the draw objective to the draw route and the read objective elsewhere', () => {
    const registry = new MetricsRegistry();
    registry.recordRoute({
      durationMs: 1_200,
      method: 'POST',
      route: '/v1/fortunes/draw',
      statusCode: 200,
    });
    registry.recordRoute({
      durationMs: 1_200,
      method: 'GET',
      route: '/v1/fortune/state',
      statusCode: 200,
    });

    const alerts = registry.snapshot().alerts.map((entry) => entry.alert);
    expect(alerts).toContain('READ_LATENCY_OBJECTIVE_MISSED');
    expect(alerts).not.toContain('DRAW_LATENCY_OBJECTIVE_MISSED');
  });

  it('raises the draw alert only past the draw objective', () => {
    const registry = new MetricsRegistry();
    registry.recordRoute({
      durationMs: 3_000,
      method: 'POST',
      route: '/v1/fortunes/draw',
      statusCode: 200,
    });

    expect(registry.snapshot().alerts.map((entry) => entry.alert)).toContain(
      'DRAW_LATENCY_OBJECTIVE_MISSED',
    );
  });

  it('derives purchase-delivery failure from money-bearing route outcomes', () => {
    const registry = new MetricsRegistry();
    for (let index = 0; index < 98; index += 1) {
      registry.recordRoute({
        durationMs: 40,
        method: 'POST',
        route: '/v1/iap/transactions',
        statusCode: 200,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      registry.recordRoute({
        durationMs: 40,
        method: 'POST',
        route: '/v1/iap/transactions',
        statusCode: 503,
      });
    }

    const snapshot = registry.snapshot();
    expect(snapshot.purchaseDelivery).toMatchObject({ failed: 2, total: 100 });
    expect(snapshot.alerts.map((entry) => entry.alert)).toContain('PURCHASE_DELIVERY_FAILING');
  });

  it('does not count an ordinary read as a purchase delivery', () => {
    const registry = new MetricsRegistry();
    registry.recordRoute({ durationMs: 10, method: 'GET', route: '/v1/me', statusCode: 500 });

    expect(registry.snapshot().purchaseDelivery.total).toBe(0);
  });

  it('does not count an Ask-to-Buy pending purchase as a failure', () => {
    const registry = new MetricsRegistry();
    registry.recordPurchaseDelivery('pending');

    expect(registry.snapshot().purchaseDelivery.total).toBe(0);
  });

  it('reports the last reconciliation and alerts once it stalls', () => {
    const clock = createClock(1_800_000_000_000);
    const registry = new MetricsRegistry({ now: clock.now });
    registry.recordReconciliation({
      completedAt: '2026-08-07T00:00:00.000Z',
      durationMs: 4_200,
      ran: true,
      reconciled: 7,
    });

    expect(registry.snapshot().reconciliation).toMatchObject({ ran: true, reconciled: 7 });
    expect(registry.snapshot().alerts).toEqual([]);

    clock.advanceMinutes(13 * 60);
    expect(registry.snapshot().alerts.map((entry) => entry.alert)).toContain(
      'RECONCILIATION_STALLED',
    );
  });

  it('records database work under its own operation label', () => {
    const registry = new MetricsRegistry();
    registry.recordDatabase({
      attempts: 2,
      durationMs: 35,
      operation: 'fortune-draw',
      outcome: 'committed',
    });

    expect(registry.snapshot().database['fortune-draw']).toMatchObject({ count: 1 });
  });

  it('resets latency on flush but keeps the rolling alert windows intact', () => {
    const registry = new MetricsRegistry();
    for (let index = 0; index < 100; index += 1) {
      registry.recordRoute({
        durationMs: 10,
        method: 'POST',
        route: '/v1/iap/transactions',
        statusCode: index < 3 ? 500 : 200,
      });
    }

    const flushed = registry.flush(silentLogger);
    expect(flushed.routes['POST /v1/iap/transactions']?.count).toBe(100);

    const after = registry.snapshot();
    expect(after.routes['POST /v1/iap/transactions']?.count).toBe(0);
    expect(after.purchaseDelivery.total).toBe(100);
    expect(after.alerts.map((entry) => entry.alert)).toContain('PURCHASE_DELIVERY_FAILING');
  });
});
