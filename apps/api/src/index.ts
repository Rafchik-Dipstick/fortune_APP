export { createApiApp, type ApiRateLimitOptions, type CreateApiAppOptions } from './app.js';
export {
  InvalidApiEnvironmentError,
  parseApiEnvironment,
  type ApiEnvironment,
} from './config/environment.js';
export { ApiReadiness, type ApiReadinessSnapshot } from './health/readiness.js';
export { createApiRuntime, type ApiRuntime } from './runtime.js';
export { startApiServer, type ApiServerOptions } from './server.js';
export {
  createGracefulShutdown,
  registerShutdownSignals,
  type GracefulShutdownOptions,
  type ShutdownApi,
} from './shutdown.js';

export const apiWorkspace = {
  healthPath: apiPaths.health,
  publicApiPrefix: '/v1',
  runtime: 'node',
} as const;
import { apiPaths } from '@fortuneness/api-contracts';
