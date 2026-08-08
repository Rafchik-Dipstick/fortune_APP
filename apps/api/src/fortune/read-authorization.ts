import { type Prisma } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';

export type ReadAuthorizationFailureCode =
  'ACCOUNT_DELETION_PENDING' | 'ACCOUNT_PURGED' | 'AUTH_REQUIRED';

export type ReadAuthorizationResult =
  { authorized: false; code: ReadAuthorizationFailureCode } | { authorized: true; userId: string };

/**
 * Re-validates the authoritative user and session-family state inside the read
 * transaction without taking row locks, so read-only archive queries cannot
 * serialize behind draw or deletion writers.
 */
export async function authorizeReadAccess(
  transaction: Prisma.TransactionClient,
  authentication: AuthenticationContext,
  now: Date,
): Promise<ReadAuthorizationResult> {
  const [user, family] = await Promise.all([
    transaction.user.findUnique({
      where: { id: authentication.userId },
      select: { id: true, sessionVersion: true, status: true },
    }),
    transaction.sessionFamily.findUnique({
      where: { id: authentication.sessionFamilyId },
      select: {
        expiresAt: true,
        identityAuthenticatedAt: true,
        revokedAt: true,
        sessionVersion: true,
        userId: true,
      },
    }),
  ]);
  if (user === null || family === null) {
    return { authorized: false, code: 'AUTH_REQUIRED' };
  }
  if (user.status === 'DELETION_PENDING') {
    return { authorized: false, code: 'ACCOUNT_DELETION_PENDING' };
  }
  if (user.status === 'PURGED') {
    return { authorized: false, code: 'ACCOUNT_PURGED' };
  }
  if (
    user.status !== 'ACTIVE' ||
    family.userId !== user.id ||
    family.sessionVersion !== user.sessionVersion ||
    family.sessionVersion !== authentication.sessionVersion ||
    family.revokedAt !== null ||
    family.expiresAt <= now ||
    Math.floor(family.identityAuthenticatedAt.getTime() / 1_000) !== authentication.authTimeSeconds
  ) {
    return { authorized: false, code: 'AUTH_REQUIRED' };
  }
  return { authorized: true, userId: user.id };
}
