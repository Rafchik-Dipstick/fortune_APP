import {
  type FortuneAllowanceState,
  type IapBenefit,
  type IapCallerState,
  type IapCatalogResponse,
} from '@fortuneness/api-contracts';

import { type IapProduct, type IapPurchaseResult } from '../../modules/fortuneness-iap';

/**
 * Why a product cannot be bought right now. Every reason is a plain statement
 * of fact the player can act on; none of them is a nudge (spec section 3.5).
 */
export type ShopOfferBlockedReason =
  | 'PAYMENTS_RESTRICTED'
  | 'PRODUCT_UNAVAILABLE'
  | 'PURCHASES_UNDER_REVIEW'
  | 'PURCHASE_IN_FLIGHT'
  | 'STOREKIT_UNAVAILABLE';

export interface ShopOffer {
  /** Server-authored, product-specific benefit copy. */
  benefit: IapBenefit;
  blockedReason: ShopOfferBlockedReason | null;
  /** Localized StoreKit price, or null when the product did not load. */
  displayPrice: string | null;
  /** Localized StoreKit renewal/consumable disclosure for this product. */
  disclosure: string;
  productId: string;
  productType: 'AUTO_RENEWABLE_SUBSCRIPTION' | 'CONSUMABLE';
  purchasable: boolean;
  /** StoreKit display name; falls back to the server benefit title. */
  title: string;
}

export type ShopPurchasePhase =
  | { kind: 'CANCELLED'; productId: string }
  | { kind: 'FAILED'; message: string; productId: string }
  | { kind: 'IDLE' }
  | { kind: 'PENDING'; productId: string }
  | { kind: 'PURCHASING'; productId: string }
  | { kind: 'SUCCEEDED'; message: string; productId: string };

export interface ShopAllowanceSummary {
  detail: string;
  headline: string;
}

const subscriptionPeriodNames: Record<string, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

function periodName(unit: string, value: number): string {
  const name = subscriptionPeriodNames[unit.toLowerCase()] ?? unit.toLowerCase();
  return value === 1 ? name : `${String(value)} ${name}s`;
}

function describeIntroductoryOffer(product: IapProduct): string {
  const offer = product.introductoryOffer;
  if (offer === null) {
    return '';
  }
  const span = periodName(offer.periodUnit, offer.periodValue);
  const rounds = offer.periodCount === 1 ? '' : ` for ${String(offer.periodCount)} periods`;
  if (offer.paymentMode.toLowerCase().includes('freetrial')) {
    return ` Your Apple Account is eligible for a ${span} free trial first; the price above applies when the trial ends unless you cancel.`;
  }
  return ` Your Apple Account is eligible for an introductory price of ${offer.displayPrice} per ${span}${rounds}; the price above applies afterwards.`;
}

/**
 * Renewal and consumable disclosure. Only StoreKit-reported values are used,
 * so the sentence stays true in every storefront and currency.
 */
export function describeDisclosure(
  productType: ShopOffer['productType'],
  product: IapProduct | undefined,
): string {
  if (productType === 'CONSUMABLE') {
    return 'One-time purchase, charged once to your Apple Account. It does not renew and you may buy it again whenever you choose.';
  }
  if (product === undefined) {
    return 'Auto-renewing subscription. It renews at the price Apple shows until you cancel it at least 24 hours before the period ends in Manage Subscription.';
  }
  const period =
    product.subscriptionPeriod === null
      ? 'period'
      : periodName(product.subscriptionPeriod.unit, product.subscriptionPeriod.value);
  return `Auto-renewing subscription billed ${product.displayPrice} per ${period} to your Apple Account until you cancel. Cancel at least 24 hours before the ${period} ends in Manage Subscription; there is no minimum term.${describeIntroductoryOffer(product)}`;
}

export function blockedReasonMessage(reason: ShopOfferBlockedReason): string {
  switch (reason) {
    case 'PURCHASES_UNDER_REVIEW':
      return 'New purchases are paused on this account while support reviews it. Existing credits, readings, and Restore Purchases are unaffected.';
    case 'PAYMENTS_RESTRICTED':
      return 'This device does not allow App Store payments. Check Screen Time content and privacy restrictions.';
    case 'PRODUCT_UNAVAILABLE':
      return 'The App Store did not return this product for your storefront. Try again once you are online.';
    case 'PURCHASE_IN_FLIGHT':
      return 'Another purchase is being confirmed. This is available again as soon as it finishes.';
    case 'STOREKIT_UNAVAILABLE':
      return 'Purchases require the Fortuneness App Store build on an iPhone or iPad.';
  }
}

export interface ShopOfferInputs {
  callerState: IapCallerState | undefined;
  canMakePayments: boolean;
  catalog: IapCatalogResponse;
  products: readonly IapProduct[];
  purchasePhase: ShopPurchasePhase;
  storeKitAvailable: boolean;
}

/**
 * Merges the server benefit catalog with live StoreKit products. The server
 * decides what may be sold and what each product grants; StoreKit decides the
 * title, localized price, and offer eligibility. A product missing from either
 * side is shown as unavailable rather than guessed at.
 */
export function buildShopOffers(inputs: ShopOfferInputs): ShopOffer[] {
  const productsById = new Map(inputs.products.map((product) => [product.productId, product]));
  const benefitsById = new Map(
    inputs.catalog.benefits.map((benefit) => [benefit.productId, benefit]),
  );
  const underReview = inputs.callerState?.commerceReviewRequired === true;
  const inFlight =
    inputs.purchasePhase.kind === 'PURCHASING' || inputs.purchasePhase.kind === 'PENDING';

  const offers: ShopOffer[] = [];
  for (const catalogProduct of inputs.catalog.products) {
    const benefit = benefitsById.get(catalogProduct.productId);
    if (benefit === undefined) {
      continue;
    }
    const product = productsById.get(catalogProduct.productId);
    const blockedReason: ShopOfferBlockedReason | null = !inputs.storeKitAvailable
      ? 'STOREKIT_UNAVAILABLE'
      : !inputs.canMakePayments
        ? 'PAYMENTS_RESTRICTED'
        : underReview
          ? 'PURCHASES_UNDER_REVIEW'
          : product === undefined
            ? 'PRODUCT_UNAVAILABLE'
            : inFlight
              ? 'PURCHASE_IN_FLIGHT'
              : null;
    offers.push({
      benefit,
      blockedReason,
      disclosure: describeDisclosure(catalogProduct.productType, product),
      displayPrice: product?.displayPrice ?? null,
      productId: catalogProduct.productId,
      productType: catalogProduct.productType,
      purchasable: blockedReason === null,
      title: product?.displayName ?? benefit.title,
    });
  }
  return offers;
}

/**
 * Current status section (spec section 3.5 item 1): free draw, subscriber
 * draws remaining today, and pack-credit balance. It states the position
 * without urgency, countdown pressure, or a call to buy.
 */
export function summarizeAllowance(
  allowance: FortuneAllowanceState | undefined,
  callerState: IapCallerState | undefined,
): ShopAllowanceSummary {
  if (allowance === undefined) {
    return {
      headline: 'Your allowance is loading',
      detail: 'Nothing is purchased or consumed while this loads.',
    };
  }
  const packCredits = callerState?.spendablePackCredits ?? allowance.spendablePackCredits;
  const subscriptionState = callerState?.subscription.status ?? allowance.subscription.status;
  const subscriptionDetail =
    subscriptionState === 'GRACE_PERIOD'
      ? ' Oracle+ is in a billing grace period and still grants its daily readings.'
      : subscriptionState === 'ACTIVE'
        ? ''
        : ' Oracle+ is not active, so its daily readings are not part of this total.';
  return {
    headline: `${String(allowance.freeRemaining)} free · ${String(allowance.subscriptionRemaining)} Oracle+ · ${String(packCredits)} pack ${packCredits === 1 ? 'credit' : 'credits'}`,
    detail: `The free daily reading is always included.${subscriptionDetail} Pack credits are spent only after the free and Oracle+ readings for the day are used.`,
  };
}

/**
 * Maps a StoreKit purchase result onto the visible phase. Cancellation is a
 * neutral outcome and never an error (spec section 3.5); a pending purchase
 * grants nothing until Apple and the server confirm it.
 */
export function mapPurchaseResult(productId: string, result: IapPurchaseResult): ShopPurchasePhase {
  switch (result.outcome) {
    case 'CANCELLED':
      return { kind: 'CANCELLED', productId };
    case 'PENDING':
      return { kind: 'PENDING', productId };
    case 'PURCHASED':
      return result.transaction === null
        ? {
            kind: 'FAILED',
            productId,
            message:
              'The App Store confirmed the purchase without a signed transaction. Nothing was granted; Restore Purchases will pick it up.',
          }
        : { kind: 'PURCHASING', productId };
    case 'UNVERIFIED':
      return {
        kind: 'FAILED',
        productId,
        message:
          'The App Store transaction could not be verified, so nothing was granted. Your Apple Account is not charged for an unverified transaction.',
      };
    case 'UNKNOWN':
      return {
        kind: 'FAILED',
        productId,
        message:
          'The App Store returned an unrecognized result. Nothing was granted; try Restore Purchases before buying again.',
      };
  }
}

/**
 * Maps the server disposition of a delivered transaction onto the visible
 * phase. Every accepted disposition is reported truthfully, including the
 * ones that grant this account nothing.
 */
export function describeDelivery(
  productId: string,
  disposition:
    'ALREADY_APPLIED' | 'APPLIED' | 'DELIVERED_TO_OTHER_ACCOUNT' | 'OWNER_CLOSED_NO_BENEFIT',
  benefit: IapBenefit | undefined,
): ShopPurchasePhase {
  switch (disposition) {
    case 'APPLIED':
      return {
        kind: 'SUCCEEDED',
        productId,
        message:
          benefit === undefined
            ? 'Your purchase is confirmed and your allowance is updated.'
            : benefit.kind === 'PACK_CREDITS'
              ? `${String(benefit.units)} pack credits were added to this Fortuneness account.`
              : 'Oracle+ is active. Its daily readings are included from your next allowance check.',
      };
    case 'ALREADY_APPLIED':
      return {
        kind: 'SUCCEEDED',
        productId,
        message: 'This purchase was already recorded for this account. You were not charged again.',
      };
    case 'DELIVERED_TO_OTHER_ACCOUNT':
      return {
        kind: 'SUCCEEDED',
        productId,
        message:
          'This App Store purchase belongs to a different Fortuneness account and was delivered there. This account received nothing.',
      };
    case 'OWNER_CLOSED_NO_BENEFIT':
      return {
        kind: 'SUCCEEDED',
        productId,
        message:
          'The Fortuneness account that owns this purchase is closed, so it grants no benefit. Contact support if this looks wrong.',
      };
  }
}

/**
 * Copy for a purchase Apple accepted but the server has not applied yet. The
 * charge stands, the transaction stays unfinished, and delivery retries by
 * itself — so the message must never suggest buying again.
 */
export function deliveryFailureMessage(reason: string): string {
  switch (reason) {
    case 'NETWORK_UNAVAILABLE':
      return 'Your purchase is safe with the App Store but could not reach Fortuneness. It is delivered automatically once you are online; do not buy again.';
    case 'TRANSACTION_OWNER_UNKNOWN':
      return 'This purchase is not yet matched to a Fortuneness account. It is held for support review, nothing was lost, and buying again would charge you twice.';
    case 'RETRYABLE_CONFLICT':
      return 'Fortuneness is busy confirming another change to this account. The purchase is kept and delivered on the next attempt.';
    case 'ACCOUNT_DELETION_PENDING':
      return 'This account has a pending deletion request, so purchases are not applied. Cancel the deletion request to receive it.';
    case 'ACCOUNT_PURGED':
      return 'This Fortuneness account was purged and cannot receive benefits. Contact support with your Apple receipt.';
    case 'TRANSACTION_UNVERIFIED':
      return 'Fortuneness could not verify this transaction with Apple and granted nothing. Contact support with your Apple receipt.';
    case 'PRODUCT_NOT_ALLOWED':
      return 'This product is not sold by this version of Fortuneness. Nothing was granted; contact support with your Apple receipt.';
    default:
      return 'Your purchase is recorded with the App Store but is not confirmed yet. It is delivered automatically; do not buy again.';
  }
}

export interface RestoreSummary {
  accepted: number;
  message: string;
  rejected: number;
}

/**
 * Restore Purchases result copy. Restore is a recheck, never a charge, and
 * finding nothing is a normal, non-alarming outcome.
 */
export function summarizeRestore(
  dispositions: readonly { deliveryAccepted: boolean }[] | undefined,
  callerState: IapCallerState | undefined,
): RestoreSummary {
  const accepted = dispositions?.filter((item) => item.deliveryAccepted).length ?? 0;
  const rejected = (dispositions?.length ?? 0) - accepted;
  if (dispositions === undefined || dispositions.length === 0) {
    return {
      accepted: 0,
      rejected: 0,
      message:
        'Apple reported no purchases to restore for this Apple Account. Nothing was charged and your account is unchanged.',
    };
  }
  const balance =
    callerState === undefined
      ? ''
      : ` This account now has ${String(callerState.spendablePackCredits)} pack ${callerState.spendablePackCredits === 1 ? 'credit' : 'credits'} and Oracle+ status ${callerState.subscription.status}.`;
  const quarantined =
    rejected === 0
      ? ''
      : ` ${String(rejected)} could not be matched to this account and ${rejected === 1 ? 'was' : 'were'} left with the App Store for support review.`;
  return {
    accepted,
    rejected,
    message: `Rechecked ${String(dispositions.length)} App Store ${dispositions.length === 1 ? 'transaction' : 'transactions'}.${quarantined}${balance}`,
  };
}
