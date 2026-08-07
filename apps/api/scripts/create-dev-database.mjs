import 'dotenv/config';

import pg from 'pg';

/**
 * Creates the local development database named in `DATABASE_URL` if it is not
 * there yet. `prisma migrate deploy` fails against a database that does not
 * exist, and `migrate dev` is not allowed to touch this history, so creation is
 * its own explicit step.
 *
 * Development only: it refuses anything but a loopback host, so it can never be
 * pointed at staging or production.
 */

const { Client } = pg;
const rawUrl = process.env['DATABASE_URL'];
if (rawUrl === undefined || rawUrl.trim().length === 0) {
  throw new Error('DATABASE_URL is required. Run `npm run env:dev` first.');
}

const url = new URL(rawUrl);
if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
  throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
if (!loopbackHosts.has(url.hostname)) {
  throw new Error(
    `Refusing to create a database on non-loopback host '${url.hostname}'. This script is for local development only.`,
  );
}

const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ''));
if (databaseName.length === 0 || !/^[A-Za-z0-9_]+$/u.test(databaseName)) {
  throw new Error('DATABASE_URL must name a simple local database.');
}

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    databaseName,
  ]);
  if (existing.rowCount === 1) {
    process.stdout.write(`Database "${databaseName}" already exists.\n`);
  } else {
    // The name is validated above, and identifiers cannot be parameterised.
    await client.query(`CREATE DATABASE "${databaseName}"`);
    process.stdout.write(`Created database "${databaseName}".\n`);
  }
} finally {
  await client.end();
}
