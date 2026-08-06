import { describe, expect, it } from 'vitest';
import type {
  FortuneAllowanceState,
  IapCallerState,
  IapCatalogResponse,
} from '@fortuneness/api-contracts';

import type { IapProduct } from '../../modules/fortuneness-iap';
import {
  buildShopOffers,
  deliveryFailureMessage,
  describeDelivery,
  describeDisclosure,
  mapPurchaseResult,
  summarizeAllowance,
  summarizeRestore,
  type ShopOfferInputs,
} from './shop-catalog';

const packProductId = 'app.fortuneness.pack10';
const subscriptionProductId = 'app.fortuneness.oracleplus.monthly';

const catalog: IapCatalogResponse = {
  products: [
    { productId: packProductId, productType: 'CONSUMABLE' },
    { productId: subscriptionProductId, productType: 'AUTO_RENEWABLE_SUBSCRIPTION' },
  ],
  benefits: [
    {
      productId: packProductId,
      kind: 'PACK_CREDITS',
      units: 10,
      title: '10 Fortune Pack',
      description: 'Adds exactly 10 spendable draw credits after server verification.',
    },
    {
      productId: subscriptionProductId,
      kind: 'SUBSCRIPTION_DAILY_FORTUNES',
      units: 10,
      title: 'Oracle+ Monthly',
      description: 'Adds 10 fortunes per eligible account day while verified as active.',
    },
  ],
  gracePeriodPolicy: { enabled: true, description: 'Verified billing grace keeps benefits.' },
  appAccountToken: '2f1d6c66-6a53-4a3f-9f22-4b8d5f9b2c11',
};

function product(overrides: Partial<IapProduct> = {}): IapProduct {
  return {
    description: 'Ten spendable readings.',
    displayName: '10 Fortune Pack',
    displayPrice: '€4.99',
    introductoryOffer: null,
    productId: packProductId,
    subscriptionPeriod: null,
    type: 'Consumable',
    ...overrides,
  };
}

const subscriptionProduct = product({
  description: 'Ten daily readings.',
  displayName: 'Oracle+ Monthly',
  displayPrice: '€3.99',
  productId: subscriptionProductId,
  subscriptionPeriod: { unit: 'month', value: 1 },
  type: 'Auto-Renewable Subscription',
});

function inputs(overrides: Partial<ShopOfferInputs> = {}): ShopOfferInputs {
  return {
    callerState: undefined,
    canMakePayments: true,
    catalog,
    products: [product(), subscriptionProduct],
    purchasePhase: { kind: 'IDLE' },
    storeKitAvailable: true,
    ...overrides,
  };
}

function callerState(overrides: Partial<IapCallerState> = {}): IapCallerState {
  return {
    subscription: { status: 'NONE', entitled: false, paidThrough: null, graceThrough: null },
    spendablePackCredits: 0,
    commerceReviewRequired: false,
    ...overrides,
  };
}

function allowance(overrides: Partial<FortuneAllowanceState> = {}): FortuneAllowanceState {
  return {
    serverTime: '2026-08-07T10:00:00.000Z',
    freeRemaining: 1,
    subscriptionRemaining: 0,
    spendablePackCredits: 0,
    availableDraws: 1,
    allowancePeriodId: '0d3f4e9a-53a0-4a51-8f18-1b7f0d2c3a44',
    currentPeriodStartedAt: '2026-08-07T00:00:00.000Z',
    nextResetAt: '2026-08-08T00:00:00.000Z',
    accountTimeZone: 'Europe/Kyiv',
    reportedDeviceTimeZone: 'Europe/Kyiv',
    pendingTimeZone: null,
    timeZoneEffectiveAt: null,
    nextTimeZoneChangeEligibleAt: null,
    subscription: { status: 'NONE', entitled: false, paidThrough: null, graceThrough: null },
    ...overrides,
  };
}

describe('buildShopOffers', () => {
  it('takes prices and titles from StoreKit and benefits from the server', () => {
    const offers = buildShopOffers(inputs());

    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      displayPrice: '€4.99',
      productId: packProductId,
      productType: 'CONSUMABLE',
      purchasable: true,
      title: '10 Fortune Pack',
    });
    expect(offers[0]?.benefit.units).toBe(10);
    expect(offers[1]).toMatchObject({ displayPrice: '€3.99', purchasable: true });
    // No offer text may contain a hardcoded currency the app invented.
    for (const offer of offers) {
      expect(offer.disclosure).not.toMatch(/\$\d/u);
    }
  });

  it('marks a product the storefront did not return as unavailable instead of guessing', () => {
    const offers = buildShopOffers(inputs({ products: [product()] }));

    expect(offers[1]).toMatchObject({
      blockedReason: 'PRODUCT_UNAVAILABLE',
      displayPrice: null,
      purchasable: false,
      title: 'Oracle+ Monthly',
    });
  });

  it('blocks purchases when the device restricts App Store payments', () => {
    const offers = buildShopOffers(inputs({ canMakePayments: false }));

    expect(offers.every((offer) => offer.blockedReason === 'PAYMENTS_RESTRICTED')).toBe(true);
    expect(offers.every((offer) => !offer.purchasable)).toBe(true);
  });

  it('blocks purchase initiation while the account is under commerce review', () => {
    const offers = buildShopOffers(
      inputs({ callerState: callerState({ commerceReviewRequired: true }) }),
    );

    expect(offers.every((offer) => offer.blockedReason === 'PURCHASES_UNDER_REVIEW')).toBe(true);
  });

  it('disables every purchase button while one transaction is in flight', () => {
    for (const kind of ['PENDING', 'PURCHASING'] as const) {
      const offers = buildShopOffers(inputs({ purchasePhase: { kind, productId: packProductId } }));
      expect(offers.every((offer) => offer.blockedReason === 'PURCHASE_IN_FLIGHT')).toBe(true);
    }
  });

  it('reports StoreKit absence rather than showing a dead purchase button', () => {
    const offers = buildShopOffers(inputs({ products: [], storeKitAvailable: false }));

    expect(offers.every((offer) => offer.blockedReason === 'STOREKIT_UNAVAILABLE')).toBe(true);
  });

  it('ignores an allowlisted product with no server benefit description', () => {
    const offers = buildShopOffers(
      inputs({
        catalog: { ...catalog, benefits: catalog.benefits.slice(0, 1) },
      }),
    );

    expect(offers.map((offer) => offer.productId)).toEqual([packProductId]);
  });
});

describe('describeDisclosure', () => {
  it('states auto-renewal, period, cancellation, and no minimum term for the subscription', () => {
    const disclosure = describeDisclosure('AUTO_RENEWABLE_SUBSCRIPTION', subscriptionProduct);

    expect(disclosure).toContain('€3.99 per month');
    expect(disclosure).toContain('until you cancel');
    expect(disclosure).toContain('Manage Subscription');
    expect(disclosure).toContain('no minimum term');
  });

  it('states that the consumable is a repeatable one-time charge', () => {
    const disclosure = describeDisclosure('CONSUMABLE', product());

    expect(disclosure).toContain('does not renew');
    expect(disclosure).toContain('buy it again');
  });

  it('describes an introductory trial only while Apple reports eligibility', () => {
    const eligible = describeDisclosure('AUTO_RENEWABLE_SUBSCRIPTION', {
      ...subscriptionProduct,
      introductoryOffer: {
        displayPrice: '€0.00',
        paymentMode: 'freeTrial',
        periodCount: 1,
        periodUnit: 'week',
        periodValue: 1,
      },
    });
    expect(eligible).toContain('free trial');
    expect(describeDisclosure('AUTO_RENEWABLE_SUBSCRIPTION', subscriptionProduct)).not.toContain(
      'free trial',
    );
  });
});

describe('summarizeAllowance', () => {
  it('states the free, subscriber, and pack position and the spend order', () => {
    const summary = summarizeAllowance(
      allowance({ subscriptionRemaining: 4, spendablePackCredits: 7, availableDraws: 12 }),
      callerState({ spendablePackCredits: 7 }),
    );

    expect(summary.headline).toBe('1 free · 4 Oracle+ · 7 pack credits');
    expect(summary.detail).toContain('free daily reading is always included');
    expect(summary.detail).toContain('only after the free and Oracle+ readings');
  });

  it('prefers the freshest commerce state for the pack balance', () => {
    const summary = summarizeAllowance(
      allowance({ spendablePackCredits: 0, availableDraws: 1 }),
      callerState({ spendablePackCredits: 10 }),
    );

    expect(summary.headline).toContain('10 pack credits');
  });

  it('says a grace-period subscription still grants its readings', () => {
    const summary = summarizeAllowance(
      allowance(),
      callerState({
        subscription: {
          status: 'GRACE_PERIOD',
          entitled: true,
          paidThrough: null,
          graceThrough: '2026-08-20T00:00:00.000Z',
        },
      }),
    );

    expect(summary.detail).toContain('billing grace period');
  });

  it('never claims a balance before the authoritative state loads', () => {
    expect(summarizeAllowance(undefined, undefined).detail).toContain('Nothing is purchased');
  });
});

describe('mapPurchaseResult', () => {
  it('treats cancellation as a neutral outcome, not a failure', () => {
    expect(mapPurchaseResult(packProductId, { outcome: 'CANCELLED', transaction: null })).toEqual({
      kind: 'CANCELLED',
      productId: packProductId,
    });
  });

  it('keeps an Ask to Buy purchase pending without granting anything', () => {
    expect(mapPurchaseResult(packProductId, { outcome: 'PENDING', transaction: null })).toEqual({
      kind: 'PENDING',
      productId: packProductId,
    });
  });

  it('stays in the purchasing phase until the server accepts the signed transaction', () => {
    expect(
      mapPurchaseResult(packProductId, {
        outcome: 'PURCHASED',
        transaction: {
          originalTransactionId: '900',
          productId: packProductId,
          purchaseAtMs: 1,
          signedTransaction: 'a.b.c',
          transactionId: '900',
        },
      }),
    ).toEqual({ kind: 'PURCHASING', productId: packProductId });
  });

  it('fails closed on an unverified transaction', () => {
    const phase = mapPurchaseResult(packProductId, { outcome: 'UNVERIFIED', transaction: null });

    expect(phase.kind).toBe('FAILED');
    expect(phase.kind === 'FAILED' ? phase.message : '').toContain('nothing was granted');
  });
});

describe('describeDelivery', () => {
  it('names the exact units granted for an applied pack', () => {
    const phase = describeDelivery(packProductId, 'APPLIED', catalog.benefits[0]);

    expect(phase).toMatchObject({ kind: 'SUCCEEDED' });
    expect(phase.kind === 'SUCCEEDED' ? phase.message : '').toContain('10 pack credits');
  });

  it('says a replayed delivery did not charge again', () => {
    const phase = describeDelivery(packProductId, 'ALREADY_APPLIED', catalog.benefits[0]);

    expect(phase.kind === 'SUCCEEDED' ? phase.message : '').toContain('not charged again');
  });

  it('discloses that another account owns the purchase without implying a grant here', () => {
    const phase = describeDelivery(
      packProductId,
      'DELIVERED_TO_OTHER_ACCOUNT',
      catalog.benefits[0],
    );

    expect(phase.kind === 'SUCCEEDED' ? phase.message : '').toContain(
      'This account received nothing',
    );
  });

  it('discloses a closed owner receiving no benefit', () => {
    const phase = describeDelivery(packProductId, 'OWNER_CLOSED_NO_BENEFIT', catalog.benefits[0]);

    expect(phase.kind === 'SUCCEEDED' ? phase.message : '').toContain('grants no benefit');
  });
});

describe('deliveryFailureMessage', () => {
  it('never invites a second purchase for a charge that is already recorded', () => {
    for (const reason of [
      'NETWORK_UNAVAILABLE',
      'RETRYABLE_CONFLICT',
      'TRANSACTION_OWNER_UNKNOWN',
      'SOMETHING_NEW',
    ]) {
      const message = deliveryFailureMessage(reason);
      expect(message).not.toMatch(/try (buying|purchasing) again/iu);
      expect(message.length).toBeGreaterThan(40);
    }
  });

  it('warns that repeating an unmatched purchase would double charge', () => {
    expect(deliveryFailureMessage('TRANSACTION_OWNER_UNKNOWN')).toContain('twice');
  });

  it('explains an unverifiable transaction granted nothing', () => {
    expect(deliveryFailureMessage('TRANSACTION_UNVERIFIED')).toContain('granted nothing');
  });
});

describe('summarizeRestore', () => {
  it('reports finding nothing as a calm, non-charging outcome', () => {
    const summary = summarizeRestore([], undefined);

    expect(summary).toMatchObject({ accepted: 0, rejected: 0 });
    expect(summary.message).toContain('Nothing was charged');
  });

  it('counts accepted and quarantined transactions and states the resulting balance', () => {
    const summary = summarizeRestore(
      [{ deliveryAccepted: true }, { deliveryAccepted: true }, { deliveryAccepted: false }],
      callerState({ spendablePackCredits: 20 }),
    );

    expect(summary).toMatchObject({ accepted: 2, rejected: 1 });
    expect(summary.message).toContain('Rechecked 3 App Store transactions');
    expect(summary.message).toContain('20 pack credits');
    expect(summary.message).toContain('support review');
  });
});
