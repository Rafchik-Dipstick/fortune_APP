#!/usr/bin/env node
// Phase 13 load test for the Fortuneness API.
//
// Drives the authenticated read, draw, history, and collection surfaces plus
// the two unauthenticated boundaries — Apple login and the App Store
// webhook — at a configured concurrency, then judges the result against the
// Phase 13 service-level objectives and exits non-zero if any is missed.
//
// This is a staging tool. It needs a deployed API, that API's database, and
// that API's access-token keyring, so it cannot be part of the offline gate.
//
//   DATABASE_URL=...            the API's database, for seeding sessions
//   JWT_ACCESS_KEYS_JSON=...    the API's access-token ring
//   JWT_ACCESS_CURRENT_KEY_VERSION=...
//   JWT_ISSUER=... JWT_AUDIENCE=...
//
//   node scripts/load-test.mjs --base-url https://staging.example --sessions 100 --duration 900
//   node scripts/load-test.mjs --base-url ... --cleanup
//
// Seeded accounts are synthetic. They carry a recognisable time-zone marker
// and their identifiers are written to a run file so `--cleanup` removes
// exactly what this tool created and nothing else. Never point it at
// production: it writes rows and consumes real allowance.

import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const runFilePath = path.join(scriptDirectory, '.load-test-run.json');

/** Phase 13 acceptance thresholds. Kept identical to `observability/metrics.ts`. */
const objectives = {
  drawP95Ms: 1_500,
  readP95Ms: 750,
  serverErrorRatio: 0.01,
};

/** Marks a seeded account so cleanup can never touch a real one. */
const syntheticTimeZoneMarker = 'Etc/UTC';
const syntheticLocaleMarker = 'zz-LOAD';

function parseArguments(argv) {
  const options = {
    baseUrl: '',
    cleanup: false,
    duration: 900,
    seedOnly: false,
    sessions: 100,
    skipInvariants: false,
    skipSeed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--base-url':
        options.baseUrl = String(value);
        index += 1;
        break;
      case '--sessions':
        options.sessions = Number(value);
        index += 1;
        break;
      case '--duration':
        options.duration = Number(value);
        index += 1;
        break;
      case '--cleanup':
        options.cleanup = true;
        break;
      case '--seed-only':
        options.seedOnly = true;
        break;
      case '--skip-seed':
        options.skipSeed = true;
        break;
      case '--skip-invariants':
        options.skipInvariants = true;
        break;
      default:
        throw new Error(`Unknown argument: ${String(flag)}`);
    }
  }
  return options;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mints an access token with the deployment's own keyring. Sign in with Apple
 * needs a physical device, so a synthetic session is the only way to load-test
 * the authenticated surfaces; the token is otherwise identical to a real one
 * and takes the same verification path on every request.
 */
function mintAccessToken({ audience, issuer, key, keyVersion, sessionFamilyId, userId }) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', kid: keyVersion, typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      aud: audience,
      auth_time: issuedAt,
      exp: issuedAt + 3_600,
      iat: issuedAt,
      iss: issuer,
      sid: sessionFamilyId,
      sub: userId,
      sv: 1,
    }),
  );
  const signature = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function seedSessions(pool, count) {
  const sessions = [];
  const expiresAt = new Date(Date.now() + 6 * 3_600_000);
  for (let index = 0; index < count; index += 1) {
    const userId = randomUUID();
    const sessionFamilyId = randomUUID();
    await pool.query(
      `INSERT INTO "User" ("id", "accountTimeZone", "reportedDeviceTimeZone", "reportedDeviceLocale")
       VALUES ($1, $2, $2, $3)`,
      [userId, syntheticTimeZoneMarker, syntheticLocaleMarker],
    );
    await pool.query(
      `INSERT INTO "SessionFamily" ("id", "userId", "sessionVersion", "gameCenterAuthenticatedAt", "expiresAt")
       VALUES ($1, $2, 1, NOW(), $3)`,
      [sessionFamilyId, userId, expiresAt],
    );
    sessions.push({ sessionFamilyId, userId });
  }
  return sessions;
}

async function cleanupSessions(pool) {
  let run;
  try {
    run = JSON.parse(readFileSync(runFilePath, 'utf8'));
  } catch {
    console.log('No load-test run file found; nothing to clean up.');
    return;
  }
  const userIds = run.sessions.map((session) => session.userId);
  // Deleting the user cascades to sessions, allowance periods, and draws.
  const result = await pool.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [userIds]);
  rmSync(runFilePath, { force: true });
  console.log(`Removed ${String(result.rowCount ?? 0)} seeded accounts.`);
}

class Samples {
  #values = [];
  #statuses = new Map();

  record(durationMs, status) {
    this.#values.push(durationMs);
    this.#statuses.set(status, (this.#statuses.get(status) ?? 0) + 1);
  }

  get count() {
    return this.#values.length;
  }

  get serverErrors() {
    let total = 0;
    for (const [status, count] of this.#statuses) {
      if (status >= 500 || status === 0) {
        total += count;
      }
    }
    return total;
  }

  quantile(quantile) {
    if (this.#values.length === 0) {
      return 0;
    }
    const sorted = [...this.#values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
    return Math.round(sorted[Math.max(0, index)]);
  }

  statusCounts() {
    return Object.fromEntries([...this.#statuses].sort(([left], [right]) => left - right));
  }
}

async function timedRequest(samples, url, init) {
  const startedAt = performance.now();
  let status;
  try {
    const response = await fetch(url, init);
    status = response.status;
    // Drain the body so the connection is reusable and the timing includes it.
    await response.arrayBuffer();
  } catch {
    // A transport failure counts against the error budget exactly like a 5xx.
    status = 0;
  }
  samples.record(performance.now() - startedAt, status);
  return status;
}

/**
 * One virtual player. The mix is weighted the way the ritual actually behaves:
 * state is read on every launch and after every action, a draw is attempted
 * once and then legitimately refused, and history and collection are browsed.
 */
async function runAuthenticatedSession({ baseUrl, deadline, session, samplesByScenario }) {
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  };

  while (performance.now() < deadline) {
    await timedRequest(samplesByScenario.state, `${baseUrl}/v1/fortune/state`, { headers });
    if (performance.now() >= deadline) break;

    await timedRequest(samplesByScenario.draw, `${baseUrl}/v1/fortunes/draw`, {
      body: JSON.stringify({ intention: 'GUIDANCE' }),
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      method: 'POST',
    });
    if (performance.now() >= deadline) break;

    await timedRequest(samplesByScenario.history, `${baseUrl}/v1/fortunes?limit=20`, { headers });
    if (performance.now() >= deadline) break;

    await timedRequest(samplesByScenario.collection, `${baseUrl}/v1/collection`, { headers });
    if (performance.now() >= deadline) break;

    await timedRequest(samplesByScenario.me, `${baseUrl}/v1/me`, { headers });
  }
}

/**
 * The two unauthenticated boundaries. Both are driven with input that must be
 * rejected: a real Apple identity token needs a device, and a real notification
 * needs Apple. What this measures is the cost of *refusing* hostile input at
 * volume, which is the denial-of-service question the phase actually asks.
 */
async function runUnauthenticatedSession({ baseUrl, deadline, samplesByScenario }) {
  const headers = { 'Content-Type': 'application/json' };

  while (performance.now() < deadline) {
    await timedRequest(samplesByScenario.authReject, `${baseUrl}/v1/auth/apple`, {
      body: JSON.stringify({
        identityToken: 'headerpayload.headerpayload.signaturepart',
        nonce: randomUUID(),
        reportedDeviceLocale: 'en-US',
        reportedDeviceTimeZone: 'UTC',
        device: { id: randomUUID(), description: 'Load test' },
      }),
      headers,
      method: 'POST',
    });
    if (performance.now() >= deadline) break;

    await timedRequest(samplesByScenario.webhookReject, `${baseUrl}/v1/webhooks/app-store`, {
      body: JSON.stringify({
        signedPayload: `${'e'.repeat(40)}.${'y'.repeat(40)}.${'s'.repeat(40)}`,
      }),
      headers,
      method: 'POST',
    });
  }
}

function report(samplesByScenario) {
  let totalRequests = 0;
  let totalServerErrors = 0;
  const rows = [];

  for (const [scenario, samples] of Object.entries(samplesByScenario)) {
    totalRequests += samples.count;
    totalServerErrors += samples.serverErrors;
    rows.push({
      scenario,
      requests: samples.count,
      p50: samples.quantile(0.5),
      p95: samples.quantile(0.95),
      p99: samples.quantile(0.99),
      serverErrors: samples.serverErrors,
      statuses: JSON.stringify(samples.statusCounts()),
    });
  }

  console.table(rows);

  const serverErrorRatio = totalRequests === 0 ? 1 : totalServerErrors / totalRequests;
  const failures = [];
  const check = (name, actual, limit) => {
    const passed = actual <= limit;
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}: ${String(actual)} (limit ${String(limit)})`);
    if (!passed) {
      failures.push(name);
    }
  };

  check('state p95 ms', samplesByScenario.state.quantile(0.95), objectives.readP95Ms);
  check('history p95 ms', samplesByScenario.history.quantile(0.95), objectives.readP95Ms);
  check('collection p95 ms', samplesByScenario.collection.quantile(0.95), objectives.readP95Ms);
  check('draw p95 ms', samplesByScenario.draw.quantile(0.95), objectives.drawP95Ms);
  check('server error ratio', Number(serverErrorRatio.toFixed(4)), objectives.serverErrorRatio);

  return failures;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { Pool } = pg;
  const pool = new Pool({ connectionString: requireEnvironment('DATABASE_URL'), max: 4 });

  try {
    if (options.cleanup) {
      await cleanupSessions(pool);
      return 0;
    }

    if (options.baseUrl.length === 0) {
      throw new Error('--base-url is required.');
    }
    if (new URL(options.baseUrl).protocol !== 'https:' && !options.baseUrl.includes('localhost')) {
      throw new Error('--base-url must be HTTPS unless it is a local target.');
    }

    const keyRing = JSON.parse(requireEnvironment('JWT_ACCESS_KEYS_JSON'));
    const keyVersion = requireEnvironment('JWT_ACCESS_CURRENT_KEY_VERSION');
    if (!Object.hasOwn(keyRing, keyVersion)) {
      throw new Error('JWT_ACCESS_CURRENT_KEY_VERSION is not present in JWT_ACCESS_KEYS_JSON.');
    }
    const key = Buffer.from(keyRing[keyVersion], 'base64');

    let seeded;
    if (options.skipSeed) {
      seeded = JSON.parse(readFileSync(runFilePath, 'utf8')).sessions;
      console.log(`Reusing ${String(seeded.length)} seeded sessions.`);
    } else {
      console.log(`Seeding ${String(options.sessions)} synthetic sessions…`);
      seeded = await seedSessions(pool, options.sessions);
      writeFileSync(
        runFilePath,
        JSON.stringify({ seededAt: new Date().toISOString(), sessions: seeded }, null, 2),
      );
    }

    if (options.seedOnly) {
      console.log('Seed complete. Re-run with --skip-seed to drive traffic.');
      return 0;
    }

    const sessions = seeded.map((session) => ({
      accessToken: mintAccessToken({
        audience: requireEnvironment('JWT_AUDIENCE'),
        issuer: requireEnvironment('JWT_ISSUER'),
        key,
        keyVersion,
        sessionFamilyId: session.sessionFamilyId,
        userId: session.userId,
      }),
    }));

    const samplesByScenario = {
      authReject: new Samples(),
      collection: new Samples(),
      draw: new Samples(),
      history: new Samples(),
      me: new Samples(),
      state: new Samples(),
      webhookReject: new Samples(),
    };

    const deadline = performance.now() + options.duration * 1_000;
    console.log(
      `Driving ${String(sessions.length)} concurrent sessions against ${options.baseUrl} for ${String(options.duration)}s…`,
    );

    await Promise.all([
      ...sessions.map((session) =>
        runAuthenticatedSession({
          baseUrl: options.baseUrl,
          deadline,
          samplesByScenario,
          session,
        }),
      ),
      // One unauthenticated driver alongside the fleet: enough to price the
      // rejection paths without turning the run into a denial-of-service test.
      runUnauthenticatedSession({ baseUrl: options.baseUrl, deadline, samplesByScenario }),
    ]);

    const failures = report(samplesByScenario);

    if (!options.skipInvariants) {
      console.log('\nChecking database invariants…');
      execFileSync(
        process.execPath,
        [path.join(scriptDirectory, 'check-database-invariants.mjs')],
        {
          stdio: 'inherit',
        },
      );
    }

    if (failures.length > 0) {
      console.error(`\nService-level objectives missed: ${failures.join(', ')}`);
      return 1;
    }
    console.log('\nAll Phase 13 service-level objectives met.');
    return 0;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
