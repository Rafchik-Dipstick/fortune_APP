export { createApiApp } from './app.js';
export {
  InvalidApiEnvironmentError,
  parseApiEnvironment,
  type ApiEnvironment,
} from './config/environment.js';
export { startApiServer, type ApiServerOptions } from './server.js';

export const apiWorkspace = {
  healthPath: '/health',
  publicApiPrefix: '/v1',
  runtime: 'node',
} as const;
