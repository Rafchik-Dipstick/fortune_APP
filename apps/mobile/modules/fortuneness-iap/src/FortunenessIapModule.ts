import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core';

export interface IapSignedTransaction {
  appAccountToken?: string;
  expiresAtMs?: number;
  originalTransactionId: string;
  productId: string;
  purchaseAtMs: number;
  revocationAtMs?: number;
  /** StoreKit-verified compact JWS for `/v1/iap/transactions`. */
  signedTransaction: string;
  transactionId: string;
}

export type IapPurchaseOutcome = 'CANCELLED' | 'PENDING' | 'PURCHASED' | 'UNKNOWN' | 'UNVERIFIED';

export interface IapPurchaseResult {
  outcome: IapPurchaseOutcome;
  transaction: IapSignedTransaction | null;
}

export interface IapSubscriptionPeriod {
  unit: string;
  value: number;
}

export interface IapIntroductoryOffer {
  /** Localized StoreKit offer price; never formatted by the app. */
  displayPrice: string;
  paymentMode: string;
  periodCount: number;
  periodUnit: string;
  periodValue: number;
}

export interface IapProduct {
  description: string;
  displayName: string;
  /** Localized StoreKit price string; the UI never formats prices itself. */
  displayPrice: string;
  /** Present only when this Apple Account is currently eligible for it. */
  introductoryOffer: IapIntroductoryOffer | null;
  productId: string;
  subscriptionPeriod: IapSubscriptionPeriod | null;
  type: string;
}

export interface IapStorefront {
  countryCode: string;
  id: string;
}

interface IapEvents {
  // expo-modules-core requires an index signature on the events map. Every
  // listener below must be assignable to it, so the payload is the
  // intersection of the concrete event payloads.
  [event: string]: (payload: IapSignedTransaction & IapStorefront) => void;
  onStorefrontChange(storefront: IapStorefront): void;
  onTransactionUpdate(transaction: IapSignedTransaction): void;
}

declare class FortunenessIapNativeModule extends NativeModule<IapEvents> {
  canMakePayments(): boolean;
  fetchProductsAsync(productIds: string[]): Promise<IapProduct[]>;
  finishTransactionAsync(transactionId: string): Promise<boolean>;
  getCurrentEntitlementsAsync(): Promise<IapSignedTransaction[]>;
  getStorefrontAsync(): Promise<IapStorefront | null>;
  getUnfinishedTransactionsAsync(): Promise<IapSignedTransaction[]>;
  presentManageSubscriptionsAsync(): Promise<void>;
  purchaseAsync(productId: string, appAccountToken: string): Promise<IapPurchaseResult>;
  syncAsync(): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<FortunenessIapNativeModule>('FortunenessIap');

export function isIapNativeModuleAvailable(): boolean {
  return nativeModule !== null;
}

export function canMakePayments(): boolean {
  return nativeModule?.canMakePayments() ?? false;
}

export async function fetchIapProductsAsync(productIds: string[]): Promise<IapProduct[]> {
  return (await nativeModule?.fetchProductsAsync(productIds)) ?? [];
}

/**
 * Active App Store storefront. Prices, availability, and offer eligibility are
 * storefront-specific, so a change invalidates every cached product.
 */
export async function getIapStorefrontAsync(): Promise<IapStorefront | null> {
  return (await nativeModule?.getStorefrontAsync()) ?? null;
}

export function addStorefrontChangeListener(
  listener: (storefront: IapStorefront) => void,
): EventSubscription {
  if (nativeModule === null) {
    return { remove: () => undefined };
  }
  return nativeModule.addListener('onStorefrontChange', listener);
}

/**
 * Purchases with the server-issued purchase token as `appAccountToken`. The
 * caller must send the returned signed transaction to the server and finish
 * only after `deliveryAccepted` and `safeToFinish` are both true.
 */
export async function purchaseIapProductAsync(
  productId: string,
  appAccountToken: string,
): Promise<IapPurchaseResult> {
  if (nativeModule === null) {
    throw new Error('Purchases require a Fortuneness iOS development build.');
  }
  return nativeModule.purchaseAsync(productId, appAccountToken);
}

export async function getCurrentEntitlementsAsync(): Promise<IapSignedTransaction[]> {
  return (await nativeModule?.getCurrentEntitlementsAsync()) ?? [];
}

export async function getUnfinishedTransactionsAsync(): Promise<IapSignedTransaction[]> {
  return (await nativeModule?.getUnfinishedTransactionsAsync()) ?? [];
}

export async function finishIapTransactionAsync(transactionId: string): Promise<boolean> {
  return (await nativeModule?.finishTransactionAsync(transactionId)) ?? false;
}

/**
 * Explicit player-tapped Restore Purchases only: calls `AppStore.sync()`,
 * after which the caller re-enumerates current entitlements and unfinished
 * transactions. Normal launch must never call this.
 */
export async function restorePurchasesSyncAsync(): Promise<void> {
  if (nativeModule === null) {
    throw new Error('Restore Purchases requires a Fortuneness iOS development build.');
  }
  await nativeModule.syncAsync();
}

export async function presentManageSubscriptionsAsync(): Promise<void> {
  if (nativeModule === null) {
    throw new Error('Manage Subscription requires a Fortuneness iOS development build.');
  }
  await nativeModule.presentManageSubscriptionsAsync();
}

/**
 * Verified transaction updates from the launch-time `Transaction.updates`
 * listener. Subscribe as early as possible and buffer delivery work until an
 * account/bootstrap decision is available.
 */
export function addTransactionUpdateListener(
  listener: (transaction: IapSignedTransaction) => void,
): EventSubscription {
  if (nativeModule === null) {
    return { remove: () => undefined };
  }
  return nativeModule.addListener('onTransactionUpdate', listener);
}
