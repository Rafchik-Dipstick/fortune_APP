import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { type DatabaseEnvironment } from '../config/environment.js';
import { PrismaClient } from '../generated/prisma/client.js';

export interface DatabaseRuntime {
  checkReadiness: () => Promise<void>;
  client: PrismaClient;
  close: () => Promise<void>;
}

export const createDatabaseRuntime = (environment: DatabaseEnvironment): DatabaseRuntime => {
  const pool = new Pool({
    application_name: 'fortuneness-api',
    connectionString: environment.url,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    max: environment.poolMax,
    // Server-side deadlines are the backstop that keeps one pathological
    // statement or a contended row lock from occupying a pooled connection
    // until the client gives up. The lock timeout is deliberately shorter
    // than the statement timeout so a queued row lock surfaces as a
    // retryable conflict rather than a generic query abort.
    options: [
      `-c statement_timeout=${String(environment.statementTimeoutMs)}`,
      `-c lock_timeout=${String(environment.lockTimeoutMs)}`,
      `-c idle_in_transaction_session_timeout=${String(environment.statementTimeoutMs)}`,
    ].join(' '),
  });
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  });
  let closePromise: Promise<void> | undefined;

  return {
    client,
    checkReadiness: async () => {
      await client.$queryRaw`SELECT 1`;
    },
    close: () => {
      closePromise ??= client.$disconnect();
      return closePromise;
    },
  };
};
