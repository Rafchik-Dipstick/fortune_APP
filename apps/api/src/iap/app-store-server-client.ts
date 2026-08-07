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
import { requestBoundedHttps } from '../security/egress.js';
import { appStoreServerApiHosts } from '../security/egress-inventory.js';
import {
  type ConsumptionInformationSender,
  type MinimizedConsumptionPayload,
} from './consumption.js';
import { type AppStoreSignedDataSource } from './reconciliation.js';

/** Transaction History pages carry many signed payloads; everything else is far smaller. */
const maximumAppStoreResponseBytes = 4 * 1024 * 1024;

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

export interface AppStoreServerEgressOptions {
  timeoutMs: number;
}

/**
 * Routes Apple's client through the process egress guard instead of its
 * bundled `node-fetch` call, so App Store traffic obeys the same allowlist,
 * public-address, deadline, and response-size controls as every other
 * outbound request. `makeRequest` consumes only `ok`, `status`, and `json()`
 * from the result; the end-to-end test in this workspace exercises the real
 * library path against this override so that assumption cannot rot silently.
 */
class GuardedAppStoreServerAPIClient extends AppStoreServerAPIClient {
  readonly #allowedHosts: readonly string[];
  readonly #timeoutMs: number;

  constructor(
    credentials: AppStoreServerApiCredentials,
    bundleId: string,
    environment: CommerceEnvironment['environment'],
    egress: AppStoreServerEgressOptions,
    allowedHost: string,
  ) {
    super(
      credentials.privateKeyPem,
      credentials.keyId,
      credentials.issuerId,
      bundleId,
      toEnvironment(environment),
    );
    this.#allowedHosts = [allowedHost];
    this.#timeoutMs = egress.timeoutMs;
  }

  protected override async makeFetchRequest(
    path: string,
    parsedQueryParameters: URLSearchParams,
    method: string,
    requestBody: string | Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<never> {
    const query = parsedQueryParameters.toString();
    const response = await requestBoundedHttps({
      allowedHosts: this.#allowedHosts,
      headers,
      maxResponseBytes: maximumAppStoreResponseBytes,
      method: method as 'GET' | 'POST' | 'PUT',
      timeoutMs: this.#timeoutMs,
      url: `https://${this.#allowedHosts[0] ?? ''}${path}${query.length === 0 ? '' : `?${query}`}`,
      ...(requestBody === undefined ? {} : { body: requestBody }),
    });

    const text = response.body.toString('utf8');
    return {
      json: () => Promise.resolve(text.length === 0 ? {} : (JSON.parse(text) as unknown)),
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
    } as unknown as never;
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
    egress: AppStoreServerEgressOptions,
  ) {
    const allowedHost = appStoreServerApiHosts[environment];
    if (allowedHost === null) {
      throw new Error('The Xcode StoreKit environment has no App Store Server API.');
    }
    this.client = new GuardedAppStoreServerAPIClient(
      credentials,
      bundleId,
      environment,
      egress,
      allowedHost,
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
