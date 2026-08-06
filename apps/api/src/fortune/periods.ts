import { type Prisma } from '../generated/prisma/client.js';
import { getAccountDayBounds } from './account-day.js';

export type AllowancePeriodWithUsage = Prisma.AllowancePeriodGetPayload<{
  include: { usage: true };
}>;

export type FortuneStateUser = Prisma.UserGetPayload<Record<string, never>>;

export interface CurrentAllowancePeriod {
  period: AllowancePeriodWithUsage;
  user: FortuneStateUser;
}

async function attachUsage(
  transaction: Prisma.TransactionClient,
  period: AllowancePeriodWithUsage,
): Promise<AllowancePeriodWithUsage> {
  if (period.usage !== null) {
    return period;
  }
  const usage = await transaction.allowanceUsage.create({
    data: { userId: period.userId, allowancePeriodId: period.id },
  });
  return { ...period, usage };
}

async function createPeriod(
  transaction: Prisma.TransactionClient,
  options: {
    resetAt: Date;
    sequence: bigint;
    startedAt: Date;
    timeZoneSnapshot: string;
    userId: string;
  },
): Promise<AllowancePeriodWithUsage> {
  const period = await transaction.allowancePeriod.create({
    data: options,
    include: { usage: true },
  });
  return attachUsage(transaction, period);
}

async function nextSequence(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<bigint> {
  const previous = await transaction.allowancePeriod.findFirst({
    where: { userId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });
  return (previous?.sequence ?? 0n) + 1n;
}

async function activatePendingTimeZone(
  transaction: Prisma.TransactionClient,
  user: FortuneStateUser,
  now: Date,
): Promise<CurrentAllowancePeriod> {
  const pendingTimeZone = user.pendingTimeZone;
  const effectiveAt = user.timeZoneEffectiveAt;
  if (pendingTimeZone === null || effectiveAt === null || effectiveAt > now) {
    throw new RangeError('The pending time-zone transition is not due.');
  }
  const activationBounds = getAccountDayBounds(effectiveAt, pendingTimeZone);
  const activationPeriod = await createPeriod(transaction, {
    userId: user.id,
    sequence: await nextSequence(transaction, user.id),
    startedAt: effectiveAt,
    resetAt: activationBounds.nextResetAt,
    timeZoneSnapshot: pendingTimeZone,
  });
  const activatedUser = await transaction.user.update({
    where: { id: user.id },
    data: {
      accountTimeZone: pendingTimeZone,
      pendingTimeZone: null,
      timeZoneEffectiveAt: null,
      updatedAt: now,
    },
  });
  if (activationPeriod.resetAt > now) {
    return { period: activationPeriod, user: activatedUser };
  }
  const currentBounds = getAccountDayBounds(now, pendingTimeZone);
  return {
    period: await createPeriod(transaction, {
      userId: user.id,
      sequence: activationPeriod.sequence + 1n,
      startedAt: currentBounds.startedAt,
      resetAt: currentBounds.nextResetAt,
      timeZoneSnapshot: pendingTimeZone,
    }),
    user: activatedUser,
  };
}

export async function ensureCurrentAllowancePeriod(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<CurrentAllowancePeriod> {
  const user = await transaction.user.findUniqueOrThrow({ where: { id: userId } });
  const current = await transaction.allowancePeriod.findFirst({
    where: { userId, startedAt: { lte: now }, resetAt: { gt: now } },
    orderBy: { sequence: 'desc' },
    include: { usage: true },
  });
  const transitionDue = user.timeZoneEffectiveAt !== null && user.timeZoneEffectiveAt <= now;
  if (current !== null) {
    if (transitionDue) {
      throw new RangeError('A due time-zone transition still overlaps a current period.');
    }
    return { user, period: await attachUsage(transaction, current) };
  }
  if (transitionDue) {
    return activatePendingTimeZone(transaction, user, now);
  }
  const bounds = getAccountDayBounds(now, user.accountTimeZone);
  const resetAt =
    user.timeZoneEffectiveAt !== null && user.timeZoneEffectiveAt < bounds.nextResetAt
      ? user.timeZoneEffectiveAt
      : bounds.nextResetAt;
  return {
    user,
    period: await createPeriod(transaction, {
      userId,
      sequence: await nextSequence(transaction, userId),
      startedAt: bounds.startedAt,
      resetAt,
      timeZoneSnapshot: user.accountTimeZone,
    }),
  };
}
