import { InvalidApiEnvironmentError } from './config/environment.js';
import { createApiRuntime } from './runtime.js';
import { startApiServer } from './server.js';
import { createGracefulShutdown, registerShutdownSignals } from './shutdown.js';

const start = (): void => {
  try {
    const runtime = createApiRuntime(process.env);
    const server = startApiServer(runtime.app, {
      host: '0.0.0.0',
      port: runtime.environment.port,
    });
    const shutdown = createGracefulShutdown({
      closeDependencies: runtime.database.close,
      logger: runtime.logger,
      markProcessFailed: () => {
        process.exitCode = 1;
      },
      readiness: runtime.readiness,
      server,
    });

    registerShutdownSignals(shutdown);
    server.once('listening', () => {
      runtime.logger.info({ port: runtime.environment.port }, 'API listener ready');
    });
    server.once('error', (error) => {
      runtime.logger.fatal(
        { errorName: error.name, errorCode: 'code' in error ? error.code : undefined },
        'API listener failed',
      );
      process.exitCode = 1;
      void shutdown('SERVER_ERROR');
    });
  } catch (error) {
    const message =
      error instanceof InvalidApiEnvironmentError
        ? error.message
        : 'The API failed during startup before logging was available.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
};

start();
