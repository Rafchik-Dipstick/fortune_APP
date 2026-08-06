import { lockUserForUpdate, runReadCommittedTransaction } from '../db/transactions.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { canonicalizeIanaTimeZone, planMaterialTimeZoneChange } from './account-day.js';
import { ensureCurrentAllowancePeriod, type FortuneStateUser } from './periods.js';

export class TimeZoneChangeLimitedError extends Error {
  readonly nextEligibleAt: Date;

  constructor(nextEligibleAt: Date) {
    super('The account time zone cannot be changed again yet.');
    this.name = 'TimeZoneChangeLimitedError';
    this.nextEligibleAt = nextEligibleAt;
  }
}

export class AccountTimeZoneService {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(userId: string, requestedTimeZoneInput: string): Promise<FortuneStateUser> {
    const requestedTimeZone = canonicalizeIanaTimeZone(requestedTimeZoneInput);
    return runReadCommittedTransaction(this.client, async (transaction) => {
      await lockUserForUpdate(transaction, userId);
      const now = this.now();
      const current = await ensureCurrentAllowancePeriod(transaction, userId, now);
      if (
        requestedTimeZone === current.user.accountTimeZone ||
        requestedTimeZone === current.user.pendingTimeZone
      ) {
        return current.user;
      }
      if (
        current.user.nextTimeZoneChangeEligibleAt !== null &&
        current.user.nextTimeZoneChangeEligibleAt > now
      ) {
        throw new TimeZoneChangeLimitedError(current.user.nextTimeZoneChangeEligibleAt);
      }
      const plan = planMaterialTimeZoneChange({
        currentPeriodResetAt: current.period.resetAt,
        now,
        requestedTimeZone,
      });
      await transaction.allowancePeriod.update({
        where: { userId_id: { userId, id: current.period.id } },
        data: { resetAt: plan.timeZoneEffectiveAt },
      });
      return transaction.user.update({
        where: { id: userId },
        data: {
          pendingTimeZone: plan.requestedTimeZone,
          timeZoneEffectiveAt: plan.timeZoneEffectiveAt,
          nextTimeZoneChangeEligibleAt: plan.nextTimeZoneChangeEligibleAt,
          updatedAt: now,
        },
      });
    });
  }
}
