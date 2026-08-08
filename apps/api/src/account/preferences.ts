import {
  preferencesUpdateResponseSchema,
  type PreferencesUpdateRequest,
  type PreferencesUpdateResponse,
} from '@fortuneness/api-contracts';

import {
  lockSessionFamilyForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { canonicalizeIanaTimeZone } from '../fortune/account-day.js';
import { TimeZoneChangeLimitedError } from '../fortune/time-zone-change.js';
import { type AccountTimeZoneService } from '../fortune/time-zone-change.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';

export type PreferencesErrorCode =
  | 'ACCOUNT_DELETION_PENDING'
  | 'ACCOUNT_PURGED'
  | 'AUTH_REQUIRED'
  | 'TIME_ZONE_CHANGE_LIMITED'
  | 'VALIDATION_FAILED';

export class PreferencesError extends Error {
  readonly code: PreferencesErrorCode;
  readonly nextEligibleAt: Date | undefined;

  constructor(code: PreferencesErrorCode, options: { nextEligibleAt?: Date } = {}) {
    super(`Preferences update failed: ${code}.`);
    this.name = 'PreferencesError';
    this.code = code;
    this.nextEligibleAt = options.nextEligibleAt;
  }
}

/**
 * Writes the allowlisted reminder, sound, haptic, and motion preferences.
 *
 * A requested time zone is deliberately not applied here: it goes through the
 * allowance-period state machine, which represents an accepted change as
 * pending so it can never mint an extra allowance period (spec section 6.1).
 */
export class PreferencesService {
  constructor(
    private readonly client: PrismaClient,
    private readonly timeZones: AccountTimeZoneService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async update(
    authentication: AuthenticationContext,
    update: PreferencesUpdateRequest,
  ): Promise<PreferencesUpdateResponse> {
    if (update.requestedTimeZone !== undefined) {
      try {
        canonicalizeIanaTimeZone(update.requestedTimeZone);
      } catch {
        throw new PreferencesError('VALIDATION_FAILED');
      }
    }

    await runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, authentication.userId);
      const family = await lockSessionFamilyForUpdate(transaction, authentication.sessionFamilyId);
      const now = this.now();
      this.assertAuthorized(user, family, authentication, now);

      const data = {
        ...(update.reminderEnabled === undefined
          ? {}
          : { reminderEnabled: update.reminderEnabled }),
        ...(update.reminderLocalMinutes === undefined
          ? {}
          : { reminderLocalMinutes: update.reminderLocalMinutes }),
        ...(update.soundEnabled === undefined ? {} : { soundEnabled: update.soundEnabled }),
        ...(update.hapticsEnabled === undefined ? {} : { hapticsEnabled: update.hapticsEnabled }),
        ...(update.reduceMotionPreferred === undefined
          ? {}
          : { reduceMotionPreferred: update.reduceMotionPreferred }),
      };
      if (Object.keys(data).length > 0) {
        await transaction.user.update({
          where: { id: authentication.userId },
          data: { ...data, updatedAt: now },
        });
      }
    });

    if (update.requestedTimeZone !== undefined) {
      try {
        await this.timeZones.request(authentication.userId, update.requestedTimeZone);
      } catch (error) {
        if (error instanceof TimeZoneChangeLimitedError) {
          throw new PreferencesError('TIME_ZONE_CHANGE_LIMITED', {
            nextEligibleAt: error.nextEligibleAt,
          });
        }
        throw error;
      }
    }

    const user = await this.client.user.findUniqueOrThrow({
      where: { id: authentication.userId },
    });
    return preferencesUpdateResponseSchema.parse({
      preferences: {
        reminderEnabled: user.reminderEnabled,
        reminderLocalMinutes: user.reminderLocalMinutes,
        soundEnabled: user.soundEnabled,
        hapticsEnabled: user.hapticsEnabled,
        reduceMotionPreferred: user.reduceMotionPreferred,
      },
      timeZoneState: {
        accountTimeZone: user.accountTimeZone,
        pendingTimeZone: user.pendingTimeZone,
        timeZoneEffectiveAt: user.timeZoneEffectiveAt?.toISOString() ?? null,
        nextTimeZoneChangeEligibleAt: user.nextTimeZoneChangeEligibleAt?.toISOString() ?? null,
      },
    });
  }

  private assertAuthorized(
    user: { id: string; sessionVersion: number; status: string },
    family: {
      expiresAt: Date;
      identityAuthenticatedAt: Date;
      revokedAt: Date | null;
      sessionVersion: number;
      userId: string;
    },
    authentication: AuthenticationContext,
    now: Date,
  ): void {
    if (user.status === 'DELETION_PENDING') {
      throw new PreferencesError('ACCOUNT_DELETION_PENDING');
    }
    if (user.status === 'PURGED') {
      throw new PreferencesError('ACCOUNT_PURGED');
    }
    if (
      user.status !== 'ACTIVE' ||
      family.userId !== user.id ||
      family.sessionVersion !== user.sessionVersion ||
      family.sessionVersion !== authentication.sessionVersion ||
      family.revokedAt !== null ||
      family.expiresAt <= now ||
      Math.floor(family.identityAuthenticatedAt.getTime() / 1_000) !==
        authentication.authTimeSeconds
    ) {
      throw new PreferencesError('AUTH_REQUIRED');
    }
  }
}
