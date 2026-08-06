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
  | 'TRANSACTION_UNVERIFIED'
  | 'PRODUCT_NOT_ALLOWED';

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

export interface SignedNotificationVerifier {
  verifyNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload>;
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
  environment: VerifiedIapEnvironment;
  expectedSubscriptionBillingPlanType: string | null;
  fortunePack10ProductId: string;
  oraclePlusMonthlyProductId: string;
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

  const environment = payload.environment;
  if (environment !== undefined && toEnvironment(policy.environment) !== environment) {
    throw new SignedTransactionVerificationError(
      'TRANSACTION_UNVERIFIED',
      'Verified transaction environment does not match the receiving environment.',
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

  return {
    appAccountToken,
    billingPlanType: payload.billingPlanType === undefined ? null : String(payload.billingPlanType),
    environment: policy.environment,
    expiresAt: optionalDate(payload.expiresDate),
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
    revocationAt: optionalDate(payload.revocationDate),
    revocationPercentage: revocationPercentage ?? null,
    revocationReason:
      payload.revocationReason === undefined ? null : String(payload.revocationReason),
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
  private readonly verifier: SignedDataVerifier;

  constructor(options: AppleSignedDataVerifierOptions) {
    this.policy = options.commerce;
    this.verifier = new SignedDataVerifier(
      options.rootCertificates ?? loadAppleRootCertificates(),
      true,
      toEnvironment(options.commerce.environment),
      options.bundleId,
      options.appAppleId ?? undefined,
    );
  }

  async verifyTransaction(signedTransaction: string): Promise<VerifiedAppleTransaction> {
    let payload: JWSTransactionDecodedPayload;
    try {
      payload = await this.verifier.verifyAndDecodeTransaction(signedTransaction);
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
      return await this.verifier.verifyAndDecodeNotification(signedPayload);
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
}

export type { DecodedSignedData, JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload };
