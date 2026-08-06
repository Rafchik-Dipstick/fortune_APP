import { type CommerceEnvironment } from '../config/environment.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type ApiLogger } from '../logging/logger.js';
import { type VerifiedAppleTransaction } from './verification.js';

export interface ConsumptionRequestContext {
  notificationUuid: string;
  verified: VerifiedAppleTransaction;
}

export interface ConsumptionRequestHandler {
  handleConsumptionRequest(context: ConsumptionRequestContext): Promise<void>;
}

/**
 * Minimized consumption payload. `consumptionPercentage` is present only for
 * consumables: Apple calculates it for auto-renewable subscriptions and the
 * field must never be sent for them.
 */
export interface MinimizedConsumptionPayload {
  consumptionPercentage?: number;
  customerConsented: boolean;
  deliveryStatus:
    | 'DELIVERED'
    | 'UNDELIVERED_OTHER'
    | 'UNDELIVERED_QUALITY_ISSUE'
    | 'UNDELIVERED_SERVER_OUTAGE'
    | 'UNDELIVERED_WRONG_ITEM';
  sampleContentProvided: boolean;
}

export interface ConsumptionInformationSender {
  send(transactionId: string, payload: MinimizedConsumptionPayload): Promise<void>;
}

interface ConsumptionServiceOptions {
  client: PrismaClient;
  commerce: CommerceEnvironment;
  logger?: ApiLogger;
  now?: () => Date;
  sender?: ConsumptionInformationSender;
}

const deliveryStatusDelivered = 'DELIVERED' as const;

/**
 * CONSUMPTION_REQUEST handling per spec section 7.4: the verified request is
 * already durably persisted by the notification store before this runs. Both
 * the deployment flag and per-player consent default off and consent is never
 * inferred from a purchase; without both, nothing is sent and the request is
 * safely acknowledged.
 */
export class ConsumptionService implements ConsumptionRequestHandler {
  private readonly client: PrismaClient;
  private readonly commerce: CommerceEnvironment;
  private readonly logger: ApiLogger | undefined;
  private readonly sender: ConsumptionInformationSender | undefined;

  constructor(options: ConsumptionServiceOptions) {
    this.client = options.client;
    this.commerce = options.commerce;
    this.logger = options.logger;
    this.sender = options.sender;
  }

  async handleConsumptionRequest(context: ConsumptionRequestContext): Promise<void> {
    await this.client.auditEvent.create({
      data: {
        actorType: 'APPLE',
        action: 'iap.consumption_request.received',
        targetType: 'AppStoreNotification',
        targetId: context.notificationUuid,
        metadata: {
          environment: context.verified.environment,
          productType: context.verified.productType,
          transactionId: context.verified.transactionId,
        },
      },
    });

    if (!this.commerce.consumptionInfoEnabled || this.sender === undefined) {
      return;
    }

    const transactionRow = await this.client.iapTransaction.findUnique({
      where: {
        environment_transactionId: {
          environment: context.verified.environment,
          transactionId: context.verified.transactionId,
        },
      },
      select: { financialSubjectId: true, id: true },
    });
    if (transactionRow === null) {
      return;
    }

    const consent = await this.client.consumptionConsent.findFirst({
      where: {
        financialSubjectId: transactionRow.financialSubjectId,
        scope: context.verified.productType,
        revokedAt: null,
      },
      orderBy: { grantedAt: 'desc' },
    });
    if (consent === null) {
      return;
    }

    const payload: MinimizedConsumptionPayload = {
      customerConsented: true,
      deliveryStatus: deliveryStatusDelivered,
      sampleContentProvided: false,
    };

    if (context.verified.productType === 'CONSUMABLE') {
      const grant = await this.client.packCreditGrant.findUnique({
        where: { purchaseTransactionId: transactionRow.id },
        select: { drawnUnits: true, originalUnits: true },
      });
      if (grant !== null && grant.originalUnits > 0) {
        // Milliunit fraction of the granted credits actually consumed.
        payload.consumptionPercentage = Math.round(
          (grant.drawnUnits / grant.originalUnits) * 100_000,
        );
      }
    }

    try {
      await this.sender.send(context.verified.transactionId, payload);
      await this.client.auditEvent.create({
        data: {
          actorType: 'SYSTEM',
          action: 'iap.consumption_information.sent',
          targetType: 'IapTransaction',
          targetId: `${context.verified.environment}:${context.verified.transactionId}`,
          metadata: {
            consentPolicyVersion: consent.policyVersion,
            productType: context.verified.productType,
          },
        },
      });
    } catch (error) {
      this.logger?.warn(
        {
          notificationUuid: context.notificationUuid,
          transactionId: context.verified.transactionId,
        },
        'Consumption information send failed',
      );
      throw error;
    }
  }
}
