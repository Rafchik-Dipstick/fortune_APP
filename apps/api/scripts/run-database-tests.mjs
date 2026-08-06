import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

import pg from 'pg';

const { Client } = pg;
const databasePrefix = 'fortuneness_test_';

function parseAdminUrl() {
  const rawUrl = process.env['TEST_DATABASE_ADMIN_URL'];
  if (rawUrl === undefined || rawUrl.trim().length === 0) {
    throw new Error('TEST_DATABASE_ADMIN_URL is required for isolated database tests.');
  }

  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('TEST_DATABASE_ADMIN_URL must use the PostgreSQL protocol.');
  }
  return url;
}

function quoteGeneratedIdentifier(identifier) {
  if (!identifier.startsWith(databasePrefix) || !/^[a-z0-9_]+$/u.test(identifier)) {
    throw new Error('Refusing to use an unsafe generated database identifier.');
  }
  return `"${identifier}"`;
}

async function runNpm(args, environment) {
  const npmExecPath = process.env['npm_execpath'];
  if (npmExecPath === undefined) {
    throw new Error('Run database tests through the checked-in npm script.');
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmExecPath, ...args], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Database-test command failed (${signal === null ? `exit ${String(code)}` : signal}).`,
        ),
      );
    });
  });
}

const adminUrl = parseAdminUrl();
const databaseName = `${databasePrefix}${String(Date.now())}_${randomBytes(6).toString('hex')}`;
const quotedDatabaseName = quoteGeneratedIdentifier(databaseName);
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let databaseCreated = false;
let adminConnected = false;
let operationError;

try {
  await admin.connect();
  adminConnected = true;
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    databaseName,
  ]);
  if (existing.rowCount !== 0) {
    throw new Error('Generated isolated database unexpectedly already exists.');
  }

  await admin.query(`CREATE DATABASE ${quotedDatabaseName} TEMPLATE template0`);
  databaseCreated = true;
  process.stdout.write(`Created isolated database ${databaseName}.\n`);

  const testEnvironment = {
    ...process.env,
    DATABASE_URL: testUrl.toString(),
    TEST_DATABASE_URL: testUrl.toString(),
  };
  delete testEnvironment.TEST_DATABASE_ADMIN_URL;
  await runNpm(['exec', 'prisma', '--', 'migrate', 'deploy'], testEnvironment);
  await runNpm(['run', 'db:seed'], testEnvironment);
  await runNpm(['run', 'db:seed'], testEnvironment);
  await runNpm(['run', 'test:db:integration'], testEnvironment);
  await runNpm(['run', 'db:invariants'], testEnvironment);
} catch (error) {
  operationError = error;
}

let cleanupError;
try {
  if (databaseCreated) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE ${quotedDatabaseName}`);
    const remaining = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (remaining.rowCount !== 0) {
      throw new Error('Isolated database cleanup verification failed.');
    }
    process.stdout.write(`Dropped isolated database ${databaseName}.\n`);
  }
} catch (error) {
  cleanupError = error;
} finally {
  if (adminConnected) {
    await admin.end();
  }
}

if (operationError !== undefined && cleanupError !== undefined) {
  throw new AggregateError(
    [operationError, cleanupError],
    'Database tests failed and isolated database cleanup also failed.',
  );
}
if (operationError !== undefined) {
  throw operationError;
}
if (cleanupError !== undefined) {
  throw cleanupError;
}
