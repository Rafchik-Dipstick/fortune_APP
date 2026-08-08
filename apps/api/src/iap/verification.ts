import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  type DecodedSignedData,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

import { type CommerceEnvironment } from '../config/environment.js';

const appleRootCertificateFiles = [
  'AppleComputerRootCertificate.cer',
  'AppleIncRootCertificate.cer',
  'AppleRootCA-G2.cer',
  'AppleRootCA-G3.cer',
] as const;

export type VerifiedIapEnvironment = 'SANDBOX' | 'PRODUCTION' | 'XCODE';
export type VerifiedIapProductType = 'CONSUMABLE' | 'AUTO_RENEWABLE_SUBSCRIPTION';

export type SignedTransactionVerificationErrorCode =
  'TRANSACTION_UNVERIFIED' | 'PRODUCT_NOT_ALLOWED';

export class SignedTransactionVerificationError extends Error {
  readonly code: SignedTransactionVerificationErrorCode;

  constructor(code: SignedTransactionVerificationErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SignedTransactionVerificationError';
    this.code = code;
  }
}

export interface VerifiedAppleTransaction {
  appAccountToken: string | null;
  billingPlanType: string | null;
  environment: VerifiedIapEnvironment;
  expiresAt: Date | null;
  jwsHash: string;
  normalizedPayload: Record<string, unknown>;
  originalTransactionId: string;
  productId: string;
  productType: VerifiedIapProductType;
  purchaseAt: Date;
  revocationAt: Date | null;
  revocationPercentage: number | null;
  revocationReason: string | null;
  signedAt: Date;
  transactionId: string;
}

export interface SignedTransactionVerifier {
  verifyTransaction(signedTransaction: string): Promise<VerifiedAppleTransaction>;
}

export interface VerifiedRenewalInfo {
  autoRenewEnabled: boolean | null;
  billingRetry: boolean | null;
  graceThrough: Date | null;
}

export interface SignedNotificationVerifier {
  verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload>;
  verifyRenewalInfo(signedRenewalInfo: string): Promise<VerifiedRenewalInfo>;
}

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

function requiredString(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0) {
    throw new SignedTransactionVerificationError(
      'TRANSACTION_UNVERIFIED',
      `Verified transaction is missing ${field}.`,
    );
  }
  return value;
}

function optionalDate(milliseconds: number | undefined): Date | null {
  return milliseconds === undefined ? null : new Date(milliseconds);
}

export function loadAppleRootCertificates(): Buffer[] {
  return appleRootCertificateFiles.map((fileName) =>
    Buffer.from(readFileSync(new URL(`../../certs/apple/${fileName}`, import.meta.url))),
  );
}

export interface AppleTransactionPolicy {
  /**
   * Environments whose transactions this deployment will honour. Production
   * carries both `PRODUCTION` and `SANDBOX`: App Review and TestFlight
   * purchase in the sandbox against the production service.
   */
  acceptedEnvironments: readonly VerifiedIapEnvironment[];
  expectedSubscriptionBillingPlanType: string | null;
  fortunePack10ProductId: string;
  oraclePlusMonthlyProductId: string;
}

/**
 * Reads the `environment` claim from an unverified JWS payload.
 *
 * Used only to choose which of Apple's trust chains to verify against, never
 * as evidence. Whichever verifier this selects still checks the signature,
 * the certificate chain, the bundle ID, and the app Apple ID, and rejects a
 * payload whose environment disagrees with its own — so a forged claim buys
 * an attacker nothing but a verification failure. Returning `null` simply
 * means every accepted environment gets tried in turn.
 */
function peekEnvironment(signedData: string): VerifiedIapEnvironment | null {
  const segments = signedData.split('.');
  if (segments.length !== 3 || segments[1] === undefined) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    const claimed =
      typeof decoded === 'object' && decoded !== null
        ? (decoded as { environment?: unknown }).environment
        : undefined;
    return claimed === 'Sandbox'
      ? 'SANDBOX'
      : claimed === 'Production'
        ? 'PRODUCTION'
        : claimed === 'Xcode'
          ? 'XCODE'
          : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes an Apple-verified decoded transaction and enforces the product
 * allowlist, product-type pairing, environment agreement, and the configured
 * subscription billing plan. Signature, certificate chain, bundle ID, and app
 * Apple ID checks happen inside the Apple verifier before this runs.
 */
export function normalizeVerifiedTransaction(
  payload: JWSTransactionDecodedPayload,
  rawSignedTransaction: string,
  policy: AppleTransactionPolicy,
): VerifiedAppleTransaction {
  const transactionId = requiredString(payload.transactionId, 'transactionId');
  const productId = requiredString(payload.productId, 'productId');
  const purchaseDate = payload.purchaseDate;
  const signedDate = payload.signedDate;
  if (purchaseDate === undefined || signedDate === undefined) {
    throw new SignedTransactionVerificationError(
      'TRANSACTION_UNVERIFIED',
      'Verified transaction is missing purchase or signing time.',
    );
  }

  // The environment is taken from the verified payload, not from configuration,
  // and must be one this deployment accepts. Recording what Apple actually
  // signed is what keeps a sandbox purchase distinguishable from a paid one
  // once production honours both.
  const accepted = policy.acceptedEnvironments;
  const payloadEnvironment: string | undefined = payload.environment;
  const transactionEnvironment =
    payloadEnvironment === undefined
      ? (accepted[0] ?? 'PRODUCTION')
      : accepted.find((candidate) => (toEnvironment(candidate) as string) === payloadEnvironment);
  if (transactionEnvironment === undefined) {
    throw new SignedTransactionVerificationError(
      'TRANSACTION_UNVERIFIED',
      'Verified transaction environment is not accepted by this deployment.',
    );
  }

  let productType: VerifiedIapProductType;
  if (productId === policy.fortunePack10ProductId) {
    productType = 'CONSUMABLE';
    if (payload.type !== undefined && payload.type !== 'Consumable') {
      throw new SignedTransactionVerificationError(
        'PRODUCT_NOT_ALLOWED',
        'The pack product must be a consumable transaction.',
      );
    }
  } else if (productId === policy.oraclePlusMonthlyProductId) {
    productType = 'AUTO_RENEWABLE_SUBSCRIPTION';
    if (payload.type !== undefined && payload.type !== 'Auto-Renewable Subscription') {
      throw new SignedTransactionVerificationError(
        'PRODUCT_NOT_ALLOWED',
        'The subscription product must be an auto-renewable transaction.',
      );
    }
    if (
      policy.expectedSubscriptionBillingPlanType !== null &&
      payload.billingPlanType !== undefined &&
      payload.billingPlanType !== policy.expectedSubscriptionBillingPlanType
    ) {
      throw new SignedTransactionVerificationError(
        'PRODUCT_NOT_ALLOWED',
        'The subscription billing plan does not match the configured standard plan.',
      );
    }
  } else {
    throw new SignedTransactionVerificationError(
      'PRODUCT_NOT_ALLOWED',
      'The product is not in the configured allowlist.',
    );
  }

  const revocationPercentage = payload.revocationPercentage;
  if (
    revocationPercentage !== undefined &&
    (!Number.isInteger(revocationPercentage) ||
      revocationPercentage < 0 ||
      revocationPercentage > 100_000)
  ) {
    throw new SignedTransactionVerificationError(
      'TRANSACTION_UNVERIFIED',
      'Verified revocation percentage is outside the documented milliunit range.',
    );
  }

  const appAccountToken =
    payload.appAccountToken === undefined || payload.appAccountToken.length === 0
      ? null
      : payload.appAccountToken.toLowerCase();

  const originalTransactionId =
    payload.originalTransactionId === undefined || payload.originalTransactionId.length === 0
      ? transactionId
      : payload.originalTransactionId;

  const isSubscription = productType === 'AUTO_RENEWABLE_SUBSCRIPTION';
  const revocationAt = optionalDate(payload.revocationDate);

  return {
    appAccountToken,
    // The database requires the pair shape: subscriptions always record a
    // billing plan and consumables never carry subscription-only fields.
    billingPlanType: isSubscription
      ? (payload.billingPlanType ?? policy.expectedSubscriptionBillingPlanType ?? 'MONTHLY')
      : null,
    environment: transactionEnvironment,
    expiresAt: isSubscription ? optionalDate(payload.expiresDate) : null,
    jwsHash: createHash('sha256').update(rawSignedTransaction, 'utf8').digest('hex'),
    normalizedPayload: {
      appTransactionId: payload.appTransactionId ?? null,
      bundleId: payload.bundleId ?? null,
      inAppOwnershipType: payload.inAppOwnershipType ?? null,
      offerType: payload.offerType ?? null,
      originalPurchaseDate: payload.originalPurchaseDate ?? null,
      quantity: payload.quantity ?? null,
      subscriptionGroupIdentifier: payload.subscriptionGroupIdentifier ?? null,
      transactionReason: payload.transactionReason ?? null,
      webOrderLineItemId: payload.webOrderLineItemId ?? null,
    },
    originalTransactionId,
    productId,
    productType,
    purchaseAt: new Date(purchaseDate),
    revocationAt,
    revocationPercentage: revocationAt === null ? null : (revocationPercentage ?? null),
    revocationReason:
      revocationAt === null
        ? null
        : payload.revocationReason === undefined
          ? '0'
          : String(payload.revocationReason),
    signedAt: new Date(signedDate),
    transactionId,
  };
}

interface AppleSignedDataVerifierOptions {
  appAppleId: number | null;
  bundleId: string;
  commerce: AppleTransactionPolicy;
  rootCertificates?: Buffer[];
}

/**
 * Verifies StoreKit 2 signed data with Apple's App Store Server Library:
 * JWS signature, Apple certificate chain, bundle ID, app Apple ID where
 * applicable, and environment, then applies the Fortuneness product policy.
 */
export class AppleSignedDataVerifier
  implements SignedTransactionVerifier, SignedNotificationVerifier
{
  private readonly policy: AppleTransactionPolicy;
  /**
   * One verifier per accepted environment. Apple's `SignedDataVerifier` is
   * bound to a single environment at construction, and a production
   * deployment has to be able to verify sandbox data as well.
   */
  private readonly verifiers: Map<VerifiedIapEnvironment, SignedDataVerifier>;

  constructor(options: AppleSignedDataVerifierOptions) {
    this.policy = options.commerce;
    const rootCertificates = options.rootCertificates ?? loadAppleRootCertificates();
    this.verifiers = new Map(
      options.commerce.acceptedEnvironments.map((environment) => [
        environment,
        new SignedDataVerifier(
          rootCertificates,
          true,
          toEnvironment(environment),
          options.bundleId,
          // The sandbox does not issue an app Apple ID, and passing the
          // production one makes Apple's verifier reject every sandbox
          // payload outright.
          environment === 'PRODUCTION' ? (options.appAppleId ?? undefined) : undefined,
        ),
      ]),
    );
  }

  /**
   * Verifies against the environment the data claims, then against the rest.
   *
   * The claim is a routing hint only — see `peekEnvironment`. Trying the
   * remaining verifiers afterwards keeps data with an absent or unexpected
   * claim working, and the last failure is what surfaces.
   */
  private async verifyAcrossEnvironments<Result>(
    signedData: string,
    verify: (verifier: SignedDataVerifier) => Promise<Result>,
  ): Promise<Result> {
    const claimed = peekEnvironment(signedData);
    const ordered = [...this.verifiers.entries()].sort(
      ([left], [right]) => Number(right === claimed) - Number(left === claimed),
    );

    let lastError: unknown;
    for (const [, verifier] of ordered) {
      try {
        return await verify(verifier);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async verifyTransaction(signedTransaction: string): Promise<VerifiedAppleTransaction> {
    let payload: JWSTransactionDecodedPayload;
    try {
      payload = await this.verifyAcrossEnvironments(signedTransaction, async (verifier) =>
        verifier.verifyAndDecodeTransaction(signedTransaction),
      );
    } catch (error) {
      throw new SignedTransactionVerificationError(
        'TRANSACTION_UNVERIFIED',
        error instanceof VerificationException
          ? `Apple signed-transaction verification failed with status ${String(error.status)}.`
          : 'Apple signed-transaction verification failed.',
        error,
      );
    }
    return normalizeVerifiedTransaction(payload, signedTransaction, this.policy);
  }

  async verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
    try {
      return await this.verifyAcrossEnvironments(signedPayload, async (verifier) =>
        verifier.verifyAndDecodeNotification(signedPayload),
      );
    } catch (error) {
      throw new SignedTransactionVerificationError(
        'TRANSACTION_UNVERIFIED',
        error instanceof VerificationException
          ? `Apple notification verification failed with status ${String(error.status)}.`
          : 'Apple notification verification failed.',
        error,
      );
    }
  }

  async verifyRenewalInfo(signedRenewalInfo: string): Promise<VerifiedRenewalInfo> {
    try {
      const payload = await this.verifyAcrossEnvironments(signedRenewalInfo, async (verifier) =>
        verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo),
      );
      return {
        autoRenewEnabled:
          payload.autoRenewStatus === undefined ? null : payload.autoRenewStatus === 1,
        billingRetry: payload.isInBillingRetryPeriod ?? null,
        graceThrough:
          payload.gracePeriodExpiresDate === undefined
            ? null
            : new Date(payload.gracePeriodExpiresDate),
      };
    } catch (error) {
      throw new SignedTransactionVerificationError(
        'TRANSACTION_UNVERIFIED',
        error instanceof VerificationException
          ? `Apple renewal-info verification failed with status ${String(error.status)}.`
          : 'Apple renewal-info verification failed.',
        error,
      );
    }
  }
}

export type { DecodedSignedData, JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload };
