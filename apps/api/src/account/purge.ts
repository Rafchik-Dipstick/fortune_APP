import {
  lockFinancialSubjectForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';

export interface PurgeResult {
  /** Requests whose transaction threw; each is retried on a later tick. */
  failed: number;
  purgedUserIds: string[];
  skipped: number;
}

export interface PurgeFailureContext {
  requestId: string;
  userId: string;
}

export interface AccountPurgeWorkerOptions {
  batchSize?: number;
  client: PrismaClient;
  leaseSeconds?: number;
  now?: () => Date;
  /** Reports a single failed request; the batch continues regardless. */
  onFailure?: (error: unknown, context: PurgeFailureContext) => void;
  workerId: string;
}

/**
 * Completes scheduled account purges (spec section 6.3).
 *
 * Ordering is the whole of the safety argument here. A lease makes exactly one
 * worker responsible for a request; inside the transaction the global
 * `User → FinancialSubject` lock order is followed; the irreversible benefit
 * cutoff and the unlinking of the financial subject happen *before* any
 * personal row is deleted, so a crash midway can never leave an account whose
 * data is gone but whose benefits are still live.
 *
 * Commerce rows are never deleted. They hang off a random internal financial
 * subject rather than the user, so purging the person leaves minimized Apple
 * facts intact without any path back to the deleted profile.
 */
export class AccountPurgeWorker {
  private readonly batchSize: number;
  private readonly client: PrismaClient;
  private readonly leaseSeconds: number;
  private readonly now: () => Date;
  private readonly onFailure: (error: unknown, context: PurgeFailureContext) => void;
  private readonly workerId: string;

  constructor(options: AccountPurgeWorkerOptions) {
    this.batchSize = options.batchSize ?? 25;
    this.client = options.client;
    this.leaseSeconds = options.leaseSeconds ?? 300;
    this.now = options.now ?? (() => new Date());
    this.onFailure = options.onFailure ?? ((): void => undefined);
    this.workerId = options.workerId;
  }

  async run(): Promise<PurgeResult> {
    const now = this.now();
    const due = await this.client.accountDeletionRequest.findMany({
      where: {
        status: 'PENDING',
        purgeAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      orderBy: { purgeAt: 'asc' },
      take: this.batchSize,
      select: { id: true, userId: true },
    });

    const purgedUserIds: string[] = [];
    let failed = 0;
    let skipped = 0;
    for (const request of due) {
      const claimed = await this.claim(request.id, now);
      if (!claimed) {
        skipped += 1;
        continue;
      }
      // The batch is ordered by `purgeAt`, so an unhandled failure here would
      // put one poisoned request in front of every other pending deletion.
      // Each request therefore fails alone and is retried once its lease
      // lapses; the reporter is what makes a permanently stuck one visible.
      let purged: boolean;
      try {
        purged = await this.purge(request.id, request.userId);
      } catch (error) {
        failed += 1;
        this.onFailure(error, { requestId: request.id, userId: request.userId });
        continue;
      }
      if (purged) {
        purgedUserIds.push(request.userId);
      } else {
        skipped += 1;
      }
    }
    return { failed, purgedUserIds, skipped };
  }

  /** Lease claim; only one worker may hold a request at a time. */
  private async claim(requestId: string, now: Date): Promise<boolean> {
    const claimed = await this.client.accountDeletionRequest.updateMany({
      where: {
        id: requestId,
        status: 'PENDING',
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        leaseOwner: this.workerId,
        leaseUntil: new Date(now.getTime() + this.leaseSeconds * 1_000),
      },
    });
    return claimed.count === 1;
  }

  private async purge(requestId: string, userId: string): Promise<boolean> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const now = this.now();
      const user = await lockUserForUpdate(transaction, userId);
      const request = await transaction.accountDeletionRequest.findUnique({
        where: { id: requestId },
      });
      // Cancellation may have won the race while we were claiming the lease.
      if (request?.status !== 'PENDING' || user.status !== 'DELETION_PENDING') {
        return false;
      }

      if (user.activeFinancialSubjectId !== null) {
        const subject = await lockFinancialSubjectForUpdate(
          transaction,
          user.activeFinancialSubjectId,
        );
        // Irreversible benefit cutoff, applied before anything is deleted.
        if (subject.benefitsDisabledAt === null) {
          // `FinancialSubject_irreversible_cutoff` refuses to close a subject
          // that still holds credit, and the closed-subject trigger refuses
          // any ledger row afterwards, so the forfeit has to be written while
          // the subject is still open — otherwise the purge can never commit.
          await this.writeOffRemainingCredit(transaction, subject.id);
          await transaction.financialSubject.update({
            where: { id: subject.id },
            data: { benefitsDisabledAt: now },
          });
        }
        // Crypto-erasure: the raw purchase token goes, the digest stays only
        // where Apple routing still requires it.
        await transaction.appAccountTokenBinding.updateMany({
          where: { financialSubjectId: subject.id, cryptoErasedAt: null },
          data: {
            encryptedToken: null,
            encryptionKeyVersion: null,
            cryptoErasedAt: now,
            validTo: now,
          },
        });
        await transaction.user.update({
          where: { id: userId },
          data: { activeFinancialSubjectId: null, updatedAt: now },
        });
      }

      await this.deletePersonalData(transaction, userId);

      await transaction.user.update({
        where: { id: userId },
        data: {
          status: 'PURGED',
          sessionVersion: { increment: 1 },
          onboardingCompletedAt: null,
          pendingTimeZone: null,
          timeZoneEffectiveAt: null,
          nextTimeZoneChangeEligibleAt: null,
          reminderEnabled: false,
          updatedAt: now,
        },
      });
      await transaction.accountDeletionRequest.update({
        where: { id: requestId },
        data: { status: 'PURGED', purgedAt: now, leaseOwner: null, leaseUntil: null },
      });
      return true;
    });
  }

  /**
   * Writes off whatever credit the subject still holds so the irreversible
   * cutoff can be applied. The ledger is append-only, so the forfeit is a new
   * terminal entry rather than an edit: it is the audit record of what the
   * account gave up, and it leaves `SUM(delta)` at zero for the cutoff trigger.
   */
  private async writeOffRemainingCredit(
    transaction: Prisma.TransactionClient,
    financialSubjectId: string,
  ): Promise<void> {
    const aggregate = await transaction.creditLedgerEntry.aggregate({
      where: { financialSubjectId },
      _sum: { delta: true },
    });
    const balance = aggregate._sum.delta ?? 0;
    if (balance === 0) {
      return;
    }
    await transaction.creditLedgerEntry.create({
      data: {
        // One cutoff per subject is possible, so the effect key is the subject.
        effectKey: `purge:${financialSubjectId}`,
        balanceAfter: 0,
        delta: -balance,
        financialSubjectId,
        reason: 'SUPPORT_ADJUSTMENT',
      },
    });
  }

  /**
   * Personal application data. Draws are removed last among the content rows
   * because credit ledger entries reference them with SET NULL, and the
   * external identity goes with them so the Game Center player is unlinked.
   *
   * That SET NULL is an UPDATE on an append-only table; the
   * `20260807120000_purgeable_ledger_detach` migration is what narrowly permits
   * it, so a spent pack credit no longer pins a deleted account's readings.
   */
  private async deletePersonalData(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.refreshToken.deleteMany({ where: { family: { userId } } });
    await transaction.sessionFamily.deleteMany({ where: { userId } });
    await transaction.externalIdentity.deleteMany({ where: { userId } });
    await transaction.idempotencyRecord.deleteMany({
      where: { actorType: 'USER', actorId: userId },
    });
    await transaction.allowanceUsage.deleteMany({ where: { userId } });
    await transaction.fortuneDraw.deleteMany({ where: { userId } });
    await transaction.allowancePeriod.deleteMany({ where: { userId } });
  }
}
