import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../generated/prisma/client.js';

export interface DatabaseRuntime {
  checkReadiness: () => Promise<void>;
  client: PrismaClient;
  close: () => Promise<void>;
}

export const createDatabaseRuntime = (connectionString: string): DatabaseRuntime => {
  const pool = new Pool({
    application_name: 'fortuneness-api',
    connectionString,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    max: 2,
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
