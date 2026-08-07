import { consumptionConsentSchema, type ConsumptionConsent } from '@fortuneness/api-contracts';

import { type CommerceEnvironment } from '../config/environment.js';
import { lockUserForUpdate, runReadCommittedTransaction } from '../db/transactions.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';

const consentScopes = ['CONSUMABLE', 'AUTO_RENEWABLE_SUBSCRIPTION'] as const;

export type ConsumptionConsentErrorCode = 'AUTH_REQUIRED' | 'VALIDATION_FAILED';

export class ConsumptionConsentError extends Error {
  readonly code: ConsumptionConsentErrorCode;

  constructor(code: ConsumptionConsentErrorCode) {
    super(`Consumption consent operation failed: ${code}.`);
    this.name = 'ConsumptionConsentError';
    this.code = code;
  }
}

/**
 * Player-facing control for the optional section 3.6 consent.
 *
 * Both the deployment flag and the player's decision default to off, and
 * consent is never inferred from a purchase. When the flag is disabled the
 * setting reports itself unavailable, the client hides it, and nothing is
 * ever sent. Revocation stops future sharing; it cannot retract what was
 * already sent, which is exactly what the setting copy tells the player.
 */
export class ConsumptionConsentService {
  constructor(
    private readonly client: PrismaClient,
    private readonly commerce: CommerceEnvironment,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(authentication: AuthenticationContext): Promise<ConsumptionConsent> {
    if (!this.commerce.consumptionInfoEnabled) {
      return consumptionConsentSchema.parse({
        available: false,
        granted: false,
        consentVersion: null,
        decidedAt: null,
      });
    }

    const user = await this.client.user.findUniqueOrThrow({
      where: { id: authentication.userId },
      select: { activeFinancialSubjectId: true },
    });
    if (user.activeFinancialSubjectId === null) {
      throw new ConsumptionConsentError('AUTH_REQUIRED');
    }

    const consent = await this.client.consumptionConsent.findFirst({
      where: { financialSubjectId: user.activeFinancialSubjectId },
      orderBy: [{ grantedAt: 'desc' }],
    });
    const granted = consent !== null && consent.revokedAt === null;
    return consumptionConsentSchema.parse({
      available: true,
      granted,
      consentVersion: consent?.policyVersion ?? null,
      decidedAt: (consent?.revokedAt ?? consent?.grantedAt)?.toISOString() ?? null,
    });
  }

  async set(
    authentication: AuthenticationContext,
    decision: { consentVersion: string; granted: boolean },
  ): Promise<ConsumptionConsent> {
    if (!this.commerce.consumptionInfoEnabled) {
      // The control does not exist while the flag is off, so a write to it is
      // a client bug rather than a decision to record.
      throw new ConsumptionConsentError('VALIDATION_FAILED');
    }

    const now = this.now();
    await runReadCommittedTransaction(this.client, async (transaction) => {
      const user = await lockUserForUpdate(transaction, authentication.userId);
      if (user.status !== 'ACTIVE' || user.activeFinancialSubjectId === null) {
        throw new ConsumptionConsentError('AUTH_REQUIRED');
      }
      const financialSubjectId = user.activeFinancialSubjectId;

      if (!decision.granted) {
        await transaction.consumptionConsent.updateMany({
          where: { financialSubjectId, revokedAt: null },
          data: { revokedAt: now },
        });
        return;
      }

      for (const scope of consentScopes) {
        const auditProof = {
          decidedAt: now.toISOString(),
          policyVersion: decision.consentVersion,
          source: 'settings-toggle',
        };
        await transaction.consumptionConsent.upsert({
          where: {
            financialSubjectId_policyVersion_scope: {
              financialSubjectId,
              policyVersion: decision.consentVersion,
              scope,
            },
          },
          create: {
            financialSubjectId,
            policyVersion: decision.consentVersion,
            scope,
            grantedAt: now,
            auditProof,
          },
          update: { grantedAt: now, revokedAt: null, auditProof },
        });
      }
      // A newer version supersedes any older grant rather than stacking.
      await transaction.consumptionConsent.updateMany({
        where: {
          financialSubjectId,
          revokedAt: null,
          policyVersion: { not: decision.consentVersion },
        },
        data: { revokedAt: now },
      });
    });

    return this.get(authentication);
  }
}
