export { createApiApp } from './app.js';
export { startApiServer, type ApiServerOptions } from './server.js';

export const apiWorkspace = {
  healthPath: '/health',
  publicApiPrefix: '/v1',
  runtime: 'node',
} as const;
