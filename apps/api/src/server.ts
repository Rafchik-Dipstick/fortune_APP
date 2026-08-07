import { type Server } from 'node:http';

import { type Express } from 'express';

export interface ApiServerOptions {
  host: string;
  /** Per-request deadline the application middleware also enforces. */
  requestTimeoutMs: number;
  port: number;
}

/**
 * Opens the process-owned listener for an already configured API app.
 *
 * The socket-level deadlines are the layer beneath the request-timeout
 * middleware: they cover a client that stalls mid-headers or mid-body, which
 * never reaches application code. `headersTimeout` stays above
 * `keepAliveTimeout` so a connection the platform proxy is reusing is not
 * closed underneath an in-flight request.
 */
export const startApiServer = (app: Express, options: ApiServerOptions): Server => {
  const server = app.listen(options.port, options.host);
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 15_000;
  server.requestTimeout = options.requestTimeoutMs;
  return server;
};
