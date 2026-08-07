import { type ApiLogger } from '../logging/logger.js';

/**
 * Process metrics for the Phase 13 service-level objectives.
 *
 * There is no scrape endpoint. Adding one would mean another authenticated,
 * rate-limited, publicly reachable surface on a service whose whole security
 * posture is "as little public surface as possible". Instead the registry
 * flushes one structured `metrics_flush` log record per interval and one
 * `operational_alert` record whenever a threshold trips. Railway ships those
 * to the log drain, which is where the dashboards and alert rules described in
 * `docs/phase13-observability-runbook.md` are built.
 *
 * Nothing recorded here is account-scoped. Route keys are express route
 * patterns, never resolved paths, so a draw identifier can never become a
 * metric label.
 */

/** Chosen so the 750 ms and 1500 ms objectives fall on exact bucket edges. */
const latencyBucketsMs = [
  5, 10, 25, 50, 100, 250, 500, 750, 1_000, 1_500, 2_500, 5_000, 10_000,
] as const;

export interface LatencySnapshot {
  count: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export class LatencyHistogram {
  readonly #counts = new Array<number>(latencyBucketsMs.length + 1).fill(0);
  #count = 0;
  #maxMs = 0;

  record(durationMs: number): void {
    const found = latencyBucketsMs.findIndex((bound) => durationMs <= bound);
    const index = found === -1 ? latencyBucketsMs.length : found;
    this.#counts[index] = (this.#counts[index] ?? 0) + 1;
    this.#count += 1;
    this.#maxMs = Math.max(this.#maxMs, durationMs);
  }

  /**
   * Reports the upper bound of the bucket containing the quantile, so a
   * reported p95 is always an over-estimate and never flatters the service.
   */
  #quantile(quantile: number): number {
    if (this.#count === 0) {
      return 0;
    }
    const target = Math.ceil(this.#count * quantile);
    let seen = 0;
    for (const [index, bucketCount] of this.#counts.entries()) {
      seen += bucketCount;
      if (seen >= target) {
        return latencyBucketsMs[index] ?? this.#maxMs;
      }
    }
    return this.#maxMs;
  }

  snapshot(): LatencySnapshot {
    return {
      count: this.#count,
      maxMs: Math.round(this.#maxMs),
      p50Ms: this.#quantile(0.5),
      p95Ms: this.#quantile(0.95),
      p99Ms: this.#quantile(0.99),
    };
  }

  reset(): void {
    this.#counts.fill(0);
    this.#count = 0;
    this.#maxMs = 0;
  }
}

/** Per-minute totals and failures over a bounded window, for rate alerts. */
export class RollingFailureRatio {
  readonly #buckets: { failed: number; minute: number; total: number }[];

  constructor(private readonly windowMinutes: number) {
    this.#buckets = Array.from({ length: windowMinutes }, () => ({
      failed: 0,
      minute: -1,
      total: 0,
    }));
  }

  record(nowMs: number, failed: boolean): void {
    const minute = Math.floor(nowMs / 60_000);
    const bucket = this.#buckets[minute % this.windowMinutes];
    if (bucket === undefined) {
      return;
    }
    if (bucket.minute !== minute) {
      bucket.minute = minute;
      bucket.failed = 0;
      bucket.total = 0;
    }
    bucket.total += 1;
    if (failed) {
      bucket.failed += 1;
    }
  }

  snapshot(nowMs: number): { failed: number; ratio: number; total: number } {
    const oldestMinute = Math.floor(nowMs / 60_000) - (this.windowMinutes - 1);
    let failed = 0;
    let total = 0;
    for (const bucket of this.#buckets) {
      if (bucket.minute < oldestMinute) {
        continue;
      }
      failed += bucket.failed;
      total += bucket.total;
    }
    return { failed, ratio: total === 0 ? 0 : failed / total, total };
  }
}

export interface RouteLatencyEvent {
  durationMs: number;
  method: string;
  route: string;
  statusCode: number;
}

export interface RouteLatencyRecorder {
  recordRoute(event: RouteLatencyEvent): void;
}

export interface DatabaseLatencyEvent {
  attempts: number;
  durationMs: number;
  operation: string;
  outcome: 'committed' | 'failed';
}

export type PurchaseDeliveryOutcome = 'delivered' | 'failed' | 'pending';

export interface ReconciliationSnapshot {
  completedAt: string;
  durationMs: number;
  /** False when another instance held the distributed lock for this tick. */
  ran: boolean;
  reconciled: number;
}

/**
 * Routes whose response is a money-bearing delivery outcome. A 2xx here means
 * the transaction was applied or terminally dispositioned; a 5xx means
 * delivery failed and Apple's transaction stays unfinished. Deriving the
 * failure ratio from the route result keeps one definition of "delivered"
 * instead of a second counter that could disagree with the HTTP contract.
 */
const purchaseDeliveryRoutes: readonly string[] = ['/v1/iap/transactions', '/v1/iap/reconcile'];

/**
 * Phase 13 acceptance thresholds and the Phase 16 halt-rollout conditions,
 * kept together so the alert rules and the release gate cannot drift apart.
 */
export const operationalThresholds = {
  /** Phase 16: five-minute API 5xx above this halts a gradual rollout. */
  haltServerErrorRatio: 0.02,
  /** Phase 16: fifteen-minute purchase-delivery failure above this halts a rollout. */
  purchaseDeliveryFailureRatio: 0.01,
  /** Phase 13 acceptance: draw p95 during the staging soak. */
  slowDrawP95Ms: 1_500,
  /** Phase 13 acceptance: state and history p95 during the staging soak. */
  slowReadP95Ms: 750,
  /** Phase 13 acceptance: API 5xx below this for the whole run. */
  soakServerErrorRatio: 0.01,
} as const;

export type OperationalAlert =
  | 'DRAW_LATENCY_OBJECTIVE_MISSED'
  | 'PURCHASE_DELIVERY_FAILING'
  | 'READ_LATENCY_OBJECTIVE_MISSED'
  | 'RECONCILIATION_STALLED'
  | 'SERVER_ERROR_RATE_HIGH';

export interface MetricsSnapshot {
  alerts: readonly { alert: OperationalAlert; detail: Record<string, number | string> }[];
  database: Record<string, LatencySnapshot>;
  purchaseDelivery: { failed: number; ratio: number; total: number };
  reconciliation: ReconciliationSnapshot | null;
  routes: Record<string, LatencySnapshot>;
  serverErrors: { failed: number; ratio: number; total: number };
}

/** Reconciliation is scheduled every six hours; twice that is unambiguously stalled. */
const reconciliationStallMs = 12 * 3_600_000;

export interface MetricsRegistryOptions {
  now?: () => number;
}

export class MetricsRegistry implements RouteLatencyRecorder {
  readonly #database = new Map<string, LatencyHistogram>();
  readonly #now: () => number;
  readonly #purchaseDelivery = new RollingFailureRatio(15);
  readonly #routes = new Map<string, LatencyHistogram>();
  readonly #serverErrors = new RollingFailureRatio(5);
  #lastReconciliation: ReconciliationSnapshot | null = null;
  #lastReconciliationAtMs: number | null = null;

  constructor(options: MetricsRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  recordRoute(event: RouteLatencyEvent): void {
    const key = `${event.method} ${event.route}`;
    const histogram = this.#routes.get(key) ?? new LatencyHistogram();
    histogram.record(event.durationMs);
    this.#routes.set(key, histogram);
    this.#serverErrors.record(this.#now(), event.statusCode >= 500);
    if (purchaseDeliveryRoutes.includes(event.route)) {
      this.recordPurchaseDelivery(event.statusCode >= 500 ? 'failed' : 'delivered');
    }
  }

  recordDatabase(event: DatabaseLatencyEvent): void {
    const histogram = this.#database.get(event.operation) ?? new LatencyHistogram();
    histogram.record(event.durationMs);
    this.#database.set(event.operation, histogram);
  }

  recordPurchaseDelivery(outcome: PurchaseDeliveryOutcome): void {
    // A pending purchase is Apple's normal Ask-to-Buy path, not a failure.
    if (outcome === 'pending') {
      return;
    }
    this.#purchaseDelivery.record(this.#now(), outcome === 'failed');
  }

  recordReconciliation(snapshot: ReconciliationSnapshot): void {
    this.#lastReconciliation = snapshot;
    this.#lastReconciliationAtMs = this.#now();
  }

  snapshot(): MetricsSnapshot {
    const nowMs = this.#now();
    const routes = Object.fromEntries(
      [...this.#routes].map(([key, histogram]) => [key, histogram.snapshot()]),
    );
    const serverErrors = this.#serverErrors.snapshot(nowMs);
    const purchaseDelivery = this.#purchaseDelivery.snapshot(nowMs);
    const alerts: { alert: OperationalAlert; detail: Record<string, number | string> }[] = [];

    if (serverErrors.total > 0 && serverErrors.ratio > operationalThresholds.haltServerErrorRatio) {
      alerts.push({
        alert: 'SERVER_ERROR_RATE_HIGH',
        detail: { ratio: serverErrors.ratio, total: serverErrors.total, windowMinutes: 5 },
      });
    }
    if (
      purchaseDelivery.total > 0 &&
      purchaseDelivery.ratio > operationalThresholds.purchaseDeliveryFailureRatio
    ) {
      alerts.push({
        alert: 'PURCHASE_DELIVERY_FAILING',
        detail: {
          ratio: purchaseDelivery.ratio,
          total: purchaseDelivery.total,
          windowMinutes: 15,
        },
      });
    }
    for (const [key, snapshot] of Object.entries(routes)) {
      const isDraw = key.endsWith('/v1/fortunes/draw');
      const objectiveMs = isDraw
        ? operationalThresholds.slowDrawP95Ms
        : operationalThresholds.slowReadP95Ms;
      if (snapshot.count > 0 && snapshot.p95Ms > objectiveMs) {
        alerts.push({
          alert: isDraw ? 'DRAW_LATENCY_OBJECTIVE_MISSED' : 'READ_LATENCY_OBJECTIVE_MISSED',
          detail: { objectiveMs, p95Ms: snapshot.p95Ms, route: key },
        });
      }
    }
    if (
      this.#lastReconciliationAtMs !== null &&
      nowMs - this.#lastReconciliationAtMs > reconciliationStallMs
    ) {
      alerts.push({
        alert: 'RECONCILIATION_STALLED',
        detail: { sinceMs: nowMs - this.#lastReconciliationAtMs },
      });
    }

    return {
      alerts,
      database: Object.fromEntries(
        [...this.#database].map(([key, histogram]) => [key, histogram.snapshot()]),
      ),
      purchaseDelivery,
      reconciliation: this.#lastReconciliation,
      routes,
      serverErrors,
    };
  }

  /**
   * Emits the interval snapshot and any tripped alert, then resets the
   * latency histograms. The rolling ratios keep their own windows so a flush
   * never truncates a five- or fifteen-minute alert window.
   */
  flush(logger: ApiLogger): MetricsSnapshot {
    const snapshot = this.snapshot();
    logger.info(
      {
        database: snapshot.database,
        event: 'metrics_flush',
        purchaseDelivery: snapshot.purchaseDelivery,
        reconciliation: snapshot.reconciliation,
        routes: snapshot.routes,
        serverErrors: snapshot.serverErrors,
      },
      'metrics flush',
    );
    for (const alert of snapshot.alerts) {
      logger.warn(
        { alert: alert.alert, event: 'operational_alert', ...alert.detail },
        'operational alert',
      );
    }
    for (const histogram of [...this.#routes.values(), ...this.#database.values()]) {
      histogram.reset();
    }
    return snapshot;
  }
}

const noopDatabaseRecorder = { recordDatabase: (): void => undefined };
let databaseRecorder: { recordDatabase: (event: DatabaseLatencyEvent) => void } =
  noopDatabaseRecorder;

/**
 * The transaction helper is called from every service and has no runtime
 * handle to inject, so its recorder is installed once per process. Tests that
 * assert on database metrics install their own registry and reset afterwards.
 */
export function installDatabaseMetricsRecorder(recorder: {
  recordDatabase: (event: DatabaseLatencyEvent) => void;
}): void {
  databaseRecorder = recorder;
}

export function resetDatabaseMetricsRecorder(): void {
  databaseRecorder = noopDatabaseRecorder;
}

export function recordDatabaseLatency(event: DatabaseLatencyEvent): void {
  databaseRecorder.recordDatabase(event);
}
