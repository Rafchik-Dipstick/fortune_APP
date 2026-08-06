import {
  AppStoreServerAPIClient,
  APIException,
  Environment,
  type ConsumptionRequest,
} from '@apple/app-store-server-library';

import {
  type AppStoreServerApiCredentials,
  type CommerceEnvironment,
} from '../config/environment.js';
import { type ConsumptionInformationSender, type MinimizedConsumptionPayload } from './consumption.js';
import { type AppStoreSignedDataSource } from './reconciliation.js';

function toEnvironment(environment: CommerceEnvironment['environment']): Environment {
  switch (environment) {
    case 'SANDBOX':
      return Environment.SANDBOX;
    case 'PRODUCTION':
      return Environment.PRODUCTION;
    case 'XCODE':
      return Environment.XCODE;
  }
}

/**
 * Thin adapter over Apple's App Store Server API client for the two V1
 * server-to-Apple calls: reconciliation reads and consumption information.
 * Only constructed when credentials are configured; the Xcode environment has
 * no server API and callers must not schedule these there.
 */
export class AppleAppStoreServerClient
  implements AppStoreSignedDataSource, ConsumptionInformationSender
{
  private readonly client: AppStoreServerAPIClient;

  constructor(
    credentials: AppStoreServerApiCredentials,
    bundleId: string,
    environment: CommerceEnvironment['environment'],
  ) {
    this.client = new AppStoreServerAPIClient(
      credentials.privateKeyPem,
      credentials.keyId,
      credentials.issuerId,
      bundleId,
      toEnvironment(environment),
    );
  }

  async getSubscriptionSignedData(originalTransactionId: string): Promise<{
    signedRenewalInfos: string[];
    signedTransactions: string[];
  }> {
    const statuses = await this.client.getAllSubscriptionStatuses(originalTransactionId);
    const signedTransactions: string[] = [];
    const signedRenewalInfos: string[] = [];
    for (const group of statuses.data ?? []) {
      for (const last of group.lastTransactions ?? []) {
        if (last.originalTransactionId !== originalTransactionId) {
          continue;
        }
        if (last.signedTransactionInfo !== undefined) {
          signedTransactions.push(last.signedTransactionInfo);
        }
        if (last.signedRenewalInfo !== undefined) {
          signedRenewalInfos.push(last.signedRenewalInfo);
        }
      }
    }
    return { signedRenewalInfos, signedTransactions };
  }

  async getTransactionInfo(transactionId: string): Promise<string | null> {
    try {
      const response = await this.client.getTransactionInfo(transactionId);
      return response.signedTransactionInfo ?? null;
    } catch (error) {
      if (error instanceof APIException && error.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async send(transactionId: string, payload: MinimizedConsumptionPayload): Promise<void> {
    const request: ConsumptionRequest = {
      customerConsented: payload.customerConsented,
      deliveryStatus: payload.deliveryStatus,
      sampleContentProvided: payload.sampleContentProvided,
      ...(payload.consumptionPercentage === undefined
        ? {}
        : { consumptionPercentage: payload.consumptionPercentage }),
    };
    await this.client.sendConsumptionInformation(transactionId, request);
  }
}
