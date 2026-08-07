/**
 * Grants the local development account an always-active Oracle+ entitlement so
 * it can draw beyond the single free daily reading. The subscription allowance
 * refills to 10 draws every daily reset, so one grant keeps working forever.
 *
 * Usage (from apps/api):
 *   npm run dev:grant             # grant to the most recent active user
 *   npm run dev:grant -- --user <uuid>
 *   npm run dev:grant -- --revoke # remove the grant again
 *
 * The entitlement is stored under the XCODE environment with a fixed
 * originalTransactionId, so it never collides with real sandbox purchases and
 * revoking deletes only what this script created.
 */
import { parseArgs } from 'node:util';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

const entitlementEnvironment = 'XCODE' as const;
const entitlementOriginalTransactionId = 'dev-local-oracle-plus';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env['DEPLOYMENT_ENVIRONMENT'] !== 'local') {
    fail(
      'Refusing to run: DEPLOYMENT_ENVIRONMENT must be "local". ' +
        'This script grants unpaid draws and must never touch a deployed database.',
    );
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    fail('DATABASE_URL is required.');
  }

  const { values } = parseArgs({
    options: {
      revoke: { type: 'boolean', default: false },
      user: { type: 'string' },
    },
  });

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    if (values.revoke) {
      const removed = await prisma.subscriptionEntitlement.deleteMany({
        where: {
          environment: entitlementEnvironment,
          originalTransactionId: entitlementOriginalTransactionId,
        },
      });
      process.stdout.write(
        removed.count === 0
          ? 'No local development entitlement to remove.\n'
          : 'Removed the local development entitlement.\n',
      );
      return;
    }

    const user =
      values.user === undefined
        ? await prisma.user.findFirst({
            where: { status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
          })
        : await prisma.user.findUnique({ where: { id: values.user } });
    if (user === null) {
      fail('No user found. Sign in from the app once so an account exists, or pass --user <uuid>.');
    }

    const financialSubjectId =
      user.activeFinancialSubjectId ??
      (await prisma.$transaction(async (transaction) => {
        const subject = await transaction.financialSubject.create({ data: {} });
        await transaction.user.update({
          where: { id: user.id },
          data: { activeFinancialSubjectId: subject.id },
        });
        return subject.id;
      }));

    const now = new Date();
    const paidThrough = new Date(now);
    paidThrough.setFullYear(paidThrough.getFullYear() + 10);
    const productId =
      process.env['IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID'] ?? 'app.fortuneness.oracleplus.monthly';

    await prisma.subscriptionEntitlement.upsert({
      where: {
        environment_originalTransactionId: {
          environment: entitlementEnvironment,
          originalTransactionId: entitlementOriginalTransactionId,
        },
      },
      create: {
        environment: entitlementEnvironment,
        originalTransactionId: entitlementOriginalTransactionId,
        financialSubjectId,
        productId,
        status: 'ACTIVE',
        paidThrough,
        autoRenewEnabled: true,
        lastAppleEventTime: now,
        lastAppleSourceId: 'dev-local-grant',
      },
      update: {
        financialSubjectId,
        productId,
        status: 'ACTIVE',
        paidThrough,
        graceThrough: null,
        revokedAt: null,
        lastAppleEventTime: now,
        lastAppleSourceId: 'dev-local-grant',
      },
    });

    process.stdout.write(
      [
        `Granted an Oracle+ entitlement to user ${user.id}.`,
        `Paid through ${paidThrough.toISOString()}.`,
        'That is 10 subscription draws per day on top of the 1 free daily draw,',
        'refilling at every daily reset. Remove it with: npm run dev:grant -- --revoke',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
