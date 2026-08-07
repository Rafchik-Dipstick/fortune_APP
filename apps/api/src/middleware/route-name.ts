import { type Request } from 'express';

/**
 * Reads the express route pattern a request matched — `/v1/fortunes/:id`, not
 * `/v1/fortunes/8f0c…`. Metric labels and error-report tags must never carry a
 * resolved identifier, and express types `request.route` as `any`, so the
 * narrowing lives here once instead of at every call site.
 */
export function matchedRoutePattern(request: Request): string {
  const route: unknown = (request as { route?: unknown }).route;
  const path =
    typeof route === 'object' && route !== null && 'path' in route
      ? (route as { path?: unknown }).path
      : undefined;
  return typeof path === 'string' ? `${request.baseUrl}${path}` : 'unmatched';
}
