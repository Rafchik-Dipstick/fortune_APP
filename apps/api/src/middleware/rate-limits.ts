import { type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { apiPaths } from '@fortuneness/api-contracts';

import { type RateLimitEnvironment } from '../config/environment.js';
import { sendApiError } from './errors.js';

export type RateLimitTier = 'authentication' | 'default' | 'draw' | 'webhook';

/**
 * Endpoints whose abuse cost is highest get their own counter rather than
 * sharing the global budget:
 *
 * - `authentication` fronts Game Center proof verification, which performs
 *   guarded certificate egress and asymmetric signature work, and is the
 *   surface for proof-replay and session-forgery attempts (AC-01, AC-02, AC-04).
 * - `draw` fronts the row-locking allowance transaction, the target of the
 *   concurrent over-issue case (AC-06).
 * - `webhook` is unauthenticated and Apple-facing: it needs a far larger
 *   budget than a client, and a separate counter so a notification flood
 *   cannot exhaust the budget a real player depends on (AC-10).
 *
 * Counters are per-tier and per-client-address. They are a resource control,
 * not a correctness control; exactly-once delivery and allowance limits are
 * enforced by database constraints regardless of what gets through here.
 */
const tierPaths: Readonly<Record<Exclude<RateLimitTier, 'default'>, readonly string[]>> = {
  authentication: [apiPaths.authGameCenter, apiPaths.authRefresh, apiPaths.authLogout],
  draw: [apiPaths.fortuneDraw],
  webhook: [apiPaths.appStoreWebhook],
};

export function resolveRateLimitTier(path: string): RateLimitTier {
  for (const [tier, paths] of Object.entries(tierPaths) as [
    Exclude<RateLimitTier, 'default'>,
    readonly string[],
  ][]) {
    if (paths.includes(path)) {
      return tier;
    }
  }
  return 'default';
}

const createTierLimiter = (limit: number, windowMs: number): RequestHandler =>
  rateLimit({
    handler: (request, response) => {
      sendApiError(response, 429, request.requestId, {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
        retryable: true,
        sameKeyRetrySafe: true,
      });
    },
    legacyHeaders: false,
    limit,
    standardHeaders: 'draft-8',
    windowMs,
  });

/**
 * Dispatches each request to exactly one tier limiter, so tiers keep
 * independent counters and only one set of rate-limit headers is written.
 * `/health` is exempt so a limiter can never make the platform believe a
 * healthy instance is unhealthy.
 */
export function createTieredRateLimit(limits: RateLimitEnvironment): RequestHandler {
  const limiters: Record<RateLimitTier, RequestHandler> = {
    authentication: createTierLimiter(limits.authenticationMax, limits.windowMs),
    default: createTierLimiter(limits.defaultMax, limits.windowMs),
    draw: createTierLimiter(limits.drawMax, limits.windowMs),
    webhook: createTierLimiter(limits.webhookMax, limits.windowMs),
  };

  return (request, response, next) => {
    if (request.path === apiPaths.health) {
      next();
      return;
    }
    limiters[resolveRateLimitTier(request.path)](request, response, next);
  };
}
