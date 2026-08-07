import { InvalidApiEnvironmentError } from './config/environment.js';
import {
  PurchaseTokenKeyMismatchError,
  verifyPurchaseTokenEncryptionKeys,
} from './iap/purchase-token-preflight.js';
import { createApiRuntime } from './runtime.js';
import { startApiServer } from './server.js';
import { createGracefulShutdown, registerShutdownSignals } from './shutdown.js';

const start = async (): Promise<void> => {
  try {
    const runtime = createApiRuntime(process.env);

    // Checked before the listener opens: key material that cannot open stored
    // purchase tokens is unrecoverable at request time, and serving traffic
    // with it produces an unexplained 500 per affected player instead of a
    // failure anyone can act on.
    const preflight = await verifyPurchaseTokenEncryptionKeys(
      runtime.database.client.appAccountTokenBinding,
      runtime.environment.authentication.appAccountTokenEncryptionKeys,
    );
    runtime.logger.info(
      {
        event: 'purchase_token_key_preflight',
        ...(preflight.status === 'verified' ? { checkedVersions: preflight.checkedVersions } : {}),
        status: preflight.status,
      },
      'app-account-token encryption key preflight',
    );

    const server = startApiServer(runtime.app, {
      host: '0.0.0.0',
      port: runtime.environment.port,
      requestTimeoutMs: runtime.environment.requestTimeoutMs,
    });
    const shutdown = createGracefulShutdown({
      closeDependencies: async () => {
        await runtime.backgroundJobs.stop();
        // The final flush is what makes the last interval and any pending
        // error report survive a deploy or a platform restart.
        runtime.metrics.flush(runtime.logger);
        await runtime.errorReporter.flush();
        await runtime.database.close();
      },
      logger: runtime.logger,
      markProcessFailed: () => {
        process.exitCode = 1;
      },
      readiness: runtime.readiness,
      server,
    });

    // A rejection or throw that escapes every handler is the failure mode most
    // likely to end delivery silently, so it is logged, reported, and then
    // allowed to take the process down through the normal shutdown path.
    process.on('unhandledRejection', (reason) => {
      runtime.logger.fatal(
        { errorName: reason instanceof Error ? reason.name : 'UnknownError' },
        'unhandled promise rejection',
      );
      runtime.errorReporter.capture(reason, { operation: 'unhandledRejection', source: 'process' });
      process.exitCode = 1;
      void shutdown('UNHANDLED_REJECTION');
    });
    process.on('uncaughtException', (error) => {
      runtime.logger.fatal({ errorName: error.name }, 'uncaught exception');
      runtime.errorReporter.capture(error, { operation: 'uncaughtException', source: 'process' });
      process.exitCode = 1;
      void shutdown('UNCAUGHT_EXCEPTION');
    });

    registerShutdownSignals(shutdown);
    server.once('listening', () => {
      runtime.backgroundJobs.start();
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
      error instanceof InvalidApiEnvironmentError ||
      error instanceof PurchaseTokenKeyMismatchError
        ? error.message
        : 'The API failed during startup before logging was available.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
};

void start();
