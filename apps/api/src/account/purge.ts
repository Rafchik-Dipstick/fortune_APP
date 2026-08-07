import {
  lockFinancialSubjectForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';

export interface PurgeResult {
  purgedUserIds: string[];
  skipped: number;
}

export interface AccountPurgeWorkerOptions {
  batchSize?: number;
  client: PrismaClient;
  leaseSeconds?: number;
  now?: () => Date;
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
  private readonly workerId: string;

  constructor(options: AccountPurgeWorkerOptions) {
    this.batchSize = options.batchSize ?? 25;
    this.client = options.client;
    this.leaseSeconds = options.leaseSeconds ?? 300;
    this.now = options.now ?? (() => new Date());
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
    let skipped = 0;
    for (const request of due) {
      const claimed = await this.claim(request.id, now);
      if (!claimed) {
        skipped += 1;
        continue;
      }
      const purged = await this.purge(request.id, request.userId);
      if (purged) {
        purgedUserIds.push(request.userId);
      } else {
        skipped += 1;
      }
    }
    return { purgedUserIds, skipped };
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
   * Personal application data. Draws are removed last among the content rows
   * because credit ledger entries reference them with SET NULL, and the
   * external identity goes with them so the Game Center player is unlinked.
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
