import { Pool } from 'pg';

export interface DatabaseRuntime {
  checkReadiness: () => Promise<void>;
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

  return {
    checkReadiness: async () => {
      await pool.query('SELECT 1');
    },
    close: async () => {
      await pool.end();
    },
  };
};
