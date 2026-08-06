import pg from 'pg';

import { type PrismaClient } from '../generated/prisma/client.js';
import { type ApiLogger } from '../logging/logger.js';
import { IapApplicationError, type IapApplicationService } from './application.js';
import {
  SignedTransactionVerificationError,
  type SignedNotificationVerifier,
  type SignedTransactionVerifier,
} from './verification.js';

const jobLockNamespace = 0x1a9_10c4;

/**
 * Holds a PostgreSQL session advisory lock for the duration of `run`. A
 * second process that fails to acquire the lock skips the run entirely, so
 * scheduled reconciliation executes on at most one instance at a time.
 */
export async function withDistributedJobLock<T>(
  connectionString: string,
  lockName: string,
  run: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  const client = new pg.Client({ connectionString, application_name: 'fortuneness-jobs' });
  await client.connect();
  try {
    const acquisition = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1, hashtext($2)) AS acquired',
      [jobLockNamespace, lockName],
    );
    if (acquisition.rows[0]?.acquired !== true) {
      return { ran: false };
    }
    try {
      return { ran: true, result: await run() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, hashtext($2))::text', [
        jobLockNamespace,
        lockName,
      ]);
    }
  } finally {
    await client.end();
  }
}

/** Signed data fetched from the App Store Server API for reconciliation. */
export interface AppStoreSignedDataSource {
  /** Signed transactions + renewal infos from Get All Subscription Statuses. */
  getSubscriptionSignedData(originalTransactionId: string): Promise<{
    signedRenewalInfos: string[];
    signedTransactions: string[];
  }>;
  /** Signed transaction from Get Transaction Info; null when Apple has none. */
  getTransactionInfo(transactionId: string): Promise<string | null>;
}

interface ReconciliationJobOptions {
  application: IapApplicationService;
  batchSize?: number;
  client: PrismaClient;
  connectionString: string;
  logger?: ApiLogger;
  now?: () => Date;
  source: AppStoreSignedDataSource;
  verifier: SignedNotificationVerifier & SignedTransactionVerifier;
}

/**
 * Scheduled authoritative reconciliation (spec section 7.4): re-fetches
 * subscription status and recent pack transaction facts from the App Store
 * Server API and pushes them through the same application service with
 * authority rank 1, under a distributed job lock.
 */
export class AppStoreReconciliationJob {
  private readonly application: IapApplicationService;
  private readonly batchSize: number;
  private readonly client: PrismaClient;
  private readonly connectionString: string;
  private readonly logger: ApiLogger | undefined;
  private readonly now: () => Date;
  private readonly source: AppStoreSignedDataSource;
  private readonly verifier: SignedNotificationVerifier & SignedTransactionVerifier;

  constructor(options: ReconciliationJobOptions) {
    this.application = options.application;
    this.batchSize = options.batchSize ?? 100;
    this.client = options.client;
    this.connectionString = options.connectionString;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.source = options.source;
    this.verifier = options.verifier;
  }

  async runOnce(): Promise<{ ran: boolean; reconciled?: number }> {
    const outcome = await withDistributedJobLock(
      this.connectionString,
      'iap-reconciliation',
      async () => {
        const subscriptions = await this.reconcileSubscriptions();
        const packs = await this.reconcileRecentPacks();
        return subscriptions + packs;
      },
    );
    return { ran: outcome.ran, ...(outcome.result === undefined ? {} : { reconciled: outcome.result }) };
  }

  private async reconcileSubscriptions(): Promise<number> {
    const now = this.now();
    const entitlements = await this.client.subscriptionEntitlement.findMany({
      where: {
        OR: [
          { status: { in: ['ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY'] } },
          { paidThrough: { gte: new Date(now.getTime() - 45 * 86_400_000) } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      select: { originalTransactionId: true },
      take: this.batchSize,
    });

    let reconciled = 0;
    for (const entitlement of entitlements) {
      try {
        const signedData = await this.source.getSubscriptionSignedData(
          entitlement.originalTransactionId,
        );
        const renewalFact =
          signedData.signedRenewalInfos.length === 0
            ? null
            : await this.verifier.verifyRenewalInfo(
                signedData.signedRenewalInfos[signedData.signedRenewalInfos.length - 1] as string,
              );
        for (const signedTransaction of signedData.signedTransactions) {
          const verified = await this.verifier.verifyTransaction(signedTransaction);
          await this.application.apply(verified, {
            authorityRank: 1,
            refundEventType: verified.revocationAt === null ? null : 'REFUND',
            renewalFact,
            sourceAt: verified.signedAt,
            sourceId: `reconcile:${verified.transactionId}`,
          });
          reconciled += 1;
        }
      } catch (error) {
        this.reportError(error, `subscription:${entitlement.originalTransactionId}`);
      }
    }
    return reconciled;
  }

  private async reconcileRecentPacks(): Promise<number> {
    const now = this.now();
    const packs = await this.client.iapTransaction.findMany({
      where: {
        productType: 'CONSUMABLE',
        purchaseAt: { gte: new Date(now.getTime() - 90 * 86_400_000) },
      },
      orderBy: { updatedAt: 'asc' },
      select: { revocationAt: true, transactionId: true },
      take: this.batchSize,
    });

    let reconciled = 0;
    for (const pack of packs) {
      try {
        const signedTransaction = await this.source.getTransactionInfo(pack.transactionId);
        if (signedTransaction === null) {
          continue;
        }
        const verified = await this.verifier.verifyTransaction(signedTransaction);
        // Only emit a clearing corrective event when a refund is currently
        // applied; an unrevoked refetch of an unrefunded pack must not record
        // a fresh fact that could outrank a genuine refund racing in.
        const refundEventType =
          verified.revocationAt !== null
            ? ('REFUND' as const)
            : pack.revocationAt !== null
              ? ('REFUND_REVERSED' as const)
              : null;
        await this.application.apply(verified, {
          authorityRank: 1,
          refundEventType,
          sourceAt: verified.signedAt,
          sourceId: `reconcile:${verified.transactionId}:${String(verified.signedAt.getTime())}`,
        });
        reconciled += 1;
      } catch (error) {
        this.reportError(error, `pack:${pack.transactionId}`);
      }
    }
    return reconciled;
  }

  private reportError(error: unknown, target: string): void {
    const errorCode =
      error instanceof IapApplicationError || error instanceof SignedTransactionVerificationError
        ? error.code
        : 'RECONCILIATION_ERROR';
    this.logger?.warn({ errorCode, target }, 'App Store reconciliation item failed');
  }
}
