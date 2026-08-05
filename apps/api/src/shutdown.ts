import { type Server } from 'node:http';

import { type ApiReadiness } from './health/readiness.js';
import { type ApiLogger } from './logging/logger.js';

export type ShutdownApi = (reason: string) => Promise<void>;

export interface GracefulShutdownOptions {
  closeDependencies: () => Promise<void>;
  logger: ApiLogger;
  markProcessFailed?: () => void;
  readiness: ApiReadiness;
  server: Server;
  timeoutMs?: number;
}

export interface ShutdownSignalSource {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export const createGracefulShutdown = (options: GracefulShutdownOptions): ShutdownApi => {
  let activeShutdown: Promise<void> | undefined;

  return (reason: string): Promise<void> => {
    if (activeShutdown !== undefined) {
      return activeShutdown;
    }

    options.readiness.stopAcceptingTraffic();
    options.logger.info({ reason }, 'graceful shutdown started');

    activeShutdown = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        options.logger.error({ reason }, 'graceful shutdown timed out');
        options.markProcessFailed?.();
        options.server.closeAllConnections();
      }, options.timeoutMs ?? 10_000);
      timeout.unref();

      options.server.close((serverError) => {
        void (async () => {
          try {
            await options.closeDependencies();
            if (serverError !== undefined) {
              throw serverError;
            }
            options.logger.info({ reason }, 'graceful shutdown completed');
          } catch (error) {
            options.logger.error(
              { errorName: error instanceof Error ? error.name : 'UnknownError', reason },
              'graceful shutdown failed',
            );
            options.markProcessFailed?.();
          } finally {
            clearTimeout(timeout);
            resolve();
          }
        })();
      });
    });

    return activeShutdown;
  };
};

export const registerShutdownSignals = (
  shutdown: ShutdownApi,
  signalSource: ShutdownSignalSource = process,
): void => {
  signalSource.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  signalSource.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
};
