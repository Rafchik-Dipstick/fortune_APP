import { randomUUID } from 'node:crypto';

import { type ApiEnvironment, type ErrorReportingTarget } from '../config/environment.js';
import { type ApiLogger } from '../logging/logger.js';
import { requestBoundedHttps } from '../security/egress.js';
import { scrubValue } from '../security/redaction.js';

/**
 * Error reporting for the API process.
 *
 * This talks to Sentry's envelope endpoint directly instead of embedding the
 * Sentry SDK, for three reasons that all matter to this phase:
 *
 * 1. The SDK auto-instruments HTTP and database calls and attaches request
 *    headers, bodies, cookies, and IPs by default. Every one of those is
 *    material the trust review says must never leave the process (AC-16), so
 *    the integration would be a list of things to switch off and keep off.
 * 2. Outbound requests must obey the process egress guard. A vendored HTTP
 *    stack would bypass the allowlist, the public-address check, and the
 *    deadline.
 * 3. It keeps a security-hardening phase from adding a large transitive
 *    dependency tree to the dependency audit it is supposed to be tightening.
 *
 * What is sent: an error type, a scrubbed message, a scrubbed stack, the
 * deployment environment, the release, a request ID for log correlation, and
 * the matched route pattern. What is never sent: player identity, request
 * bodies or headers, fortune content, Apple signed data, purchase tokens, or
 * anything else `scrubValue` recognises.
 */

export type ErrorSource = 'job' | 'process' | 'request';

export interface ReportableContext {
  /** Named job, matched route pattern, or process hook — never a resolved path. */
  operation?: string;
  requestId?: string;
  source: ErrorSource;
}

export interface ErrorReporter {
  capture(error: unknown, context: ReportableContext): void;
  flush(): Promise<void>;
}

export class NoopErrorReporter implements ErrorReporter {
  capture(): void {
    // Reporting is not configured; the structured log is the record.
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

/** Caps an error storm so it cannot become an egress storm or a vendor bill. */
const maximumEventsPerMinute = 30;
const maximumResponseBytes = 8 * 1024;

interface SentryErrorReporterOptions {
  deploymentEnvironment: ApiEnvironment['deploymentEnvironment'];
  logger: ApiLogger;
  now?: () => number;
  release: string | null;
  send?: typeof requestBoundedHttps;
  target: ErrorReportingTarget;
  timeoutMs: number;
}

export class SentryErrorReporter implements ErrorReporter {
  readonly #options: SentryErrorReporterOptions;
  readonly #inFlight = new Set<Promise<void>>();
  readonly #now: () => number;
  readonly #send: typeof requestBoundedHttps;
  #droppedSinceMinute = 0;
  #minute = -1;
  #sentThisMinute = 0;

  constructor(options: SentryErrorReporterOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#send = options.send ?? requestBoundedHttps;
  }

  capture(error: unknown, context: ReportableContext): void {
    if (!this.#admit()) {
      return;
    }

    const envelope = this.#buildEnvelope(error, context);
    const delivery = this.#deliver(envelope);
    this.#inFlight.add(delivery);
    void delivery.finally(() => {
      this.#inFlight.delete(delivery);
    });
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.#inFlight]);
  }

  #admit(): boolean {
    const minute = Math.floor(this.#now() / 60_000);
    if (minute !== this.#minute) {
      if (this.#droppedSinceMinute > 0) {
        this.#options.logger.warn(
          { dropped: this.#droppedSinceMinute, event: 'error_reports_dropped' },
          'error reports dropped by the per-minute cap',
        );
      }
      this.#minute = minute;
      this.#sentThisMinute = 0;
      this.#droppedSinceMinute = 0;
    }
    if (this.#sentThisMinute >= maximumEventsPerMinute) {
      this.#droppedSinceMinute += 1;
      return false;
    }
    this.#sentThisMinute += 1;
    return true;
  }

  #buildEnvelope(error: unknown, context: ReportableContext): string {
    const eventId = randomUUID().replaceAll('-', '');
    const sentAt = new Date(this.#now()).toISOString();
    const scrubbed = scrubValue(
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown'),
    ) as { message?: string; name?: string; stack?: string };

    const event = {
      environment: this.#options.deploymentEnvironment,
      event_id: eventId,
      exception: {
        values: [
          {
            stacktrace: scrubbed.stack === undefined ? undefined : { frames: [] },
            type: scrubbed.name ?? 'Error',
            value: scrubbed.message ?? '',
          },
        ],
      },
      extra: {
        // The stack travels as plain text so no frame parser can re-introduce
        // local variable values that the scrubbed string no longer contains.
        stack: scrubbed.stack,
      },
      level: 'error',
      logger: 'fortuneness-api',
      platform: 'node',
      ...(this.#options.release === null ? {} : { release: this.#options.release }),
      tags: {
        operation: context.operation ?? 'unknown',
        source: context.source,
      },
      timestamp: sentAt,
      ...(context.requestId === undefined ? {} : { transaction: context.requestId }),
    };

    return [
      JSON.stringify({ event_id: eventId, sent_at: sentAt }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
  }

  async #deliver(envelope: string): Promise<void> {
    try {
      await this.#send({
        allowedHosts: [this.#options.target.host],
        body: envelope,
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=fortuneness-api/1, sentry_key=${this.#options.target.publicKey}`,
        },
        maxResponseBytes: maximumResponseBytes,
        method: 'POST',
        timeoutMs: this.#options.timeoutMs,
        url: this.#options.target.envelopeUrl,
      });
    } catch (deliveryError) {
      // Reporting must never become the failure it is reporting on.
      this.#options.logger.warn(
        {
          errorName: deliveryError instanceof Error ? deliveryError.name : 'unknown',
          event: 'error_report_delivery_failed',
        },
        'error report delivery failed',
      );
    }
  }
}

/**
 * Builds the reporter for a deployment. Local runs never report: an engineer's
 * machine has the log in front of it, and local events would pollute the
 * environment separation the staging and production streams depend on.
 */
export function createErrorReporter(environment: ApiEnvironment, logger: ApiLogger): ErrorReporter {
  const target = environment.observability.errorReporting;
  if (target === null || environment.deploymentEnvironment === 'local') {
    return new NoopErrorReporter();
  }

  return new SentryErrorReporter({
    deploymentEnvironment: environment.deploymentEnvironment,
    logger,
    release: environment.observability.release,
    target,
    timeoutMs: environment.outboundRequestTimeoutMs,
  });
}
