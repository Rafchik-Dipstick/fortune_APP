import { describe, expect, it } from 'vitest';

import { MobileApiError } from '../auth/api-client';
import {
  CommerceDeliveryCoordinator,
  type CommerceDeliveryDependencies,
  type DeliverableTransaction,
} from './commerce-delivery';

const transaction = (id: string): DeliverableTransaction => ({
  signedTransaction: `signed-${id}`,
  transactionId: id,
});

const acceptedResponse = (transactionId: string, appliedNow: boolean) =>
  appliedNow
    ? ({
        transactionId,
        deliveryAccepted: true,
        safeToFinish: true,
        appliedNow: true,
        disposition: 'APPLIED',
      } as const)
    : ({
        transactionId,
        deliveryAccepted: true,
        safeToFinish: true,
        appliedNow: false,
        disposition: 'ALREADY_APPLIED',
      } as const);

interface HarnessOptions {
  accessToken?: string | null;
  deliver?: CommerceDeliveryDependencies['deliver'];
  entitlements?: DeliverableTransaction[];
  reconcile?: CommerceDeliveryDependencies['reconcile'];
  unfinished?: DeliverableTransaction[];
}

function createHarness(options: HarnessOptions = {}) {
  const finished: string[] = [];
  const delivered: string[] = [];
  const synced = { count: 0 };
  const coordinator = new CommerceDeliveryCoordinator({
    deliver:
      options.deliver ??
      (async (_accessToken, signedTransaction) => {
        delivered.push(signedTransaction);
        return acceptedResponse(signedTransaction.replace('signed-', ''), true);
      }),
    finishTransaction: async (transactionId) => {
      finished.push(transactionId);
      return true;
    },
    getAccessToken: async () => options.accessToken ?? 'access-token',
    getCurrentEntitlements: async () => options.entitlements ?? [],
    getUnfinishedTransactions: async () => options.unfinished ?? [],
    reconcile:
      options.reconcile ??
      (async () => ({
        dispositions: [],
      })),
    sync: async () => {
      synced.count += 1;
    },
  });
  return { coordinator, delivered, finished, synced };
}

describe('CommerceDeliveryCoordinator', () => {
  it('finishes a transaction only after the server accepts delivery as safe', async () => {
    const harness = createHarness();
    const result = await harness.coordinator.handleVerifiedTransaction(transaction('100'));

    expect(result.kind).toBe('DELIVERED');
    expect(harness.finished).toEqual(['100']);
  });

  it('buffers verified updates until an account decision exists, then flushes', async () => {
    let accessToken: string | null = null;
    const delivered: string[] = [];
    const finished: string[] = [];
    const coordinator = new CommerceDeliveryCoordinator({
      deliver: async (_token, signedTransaction) => {
        delivered.push(signedTransaction);
        return acceptedResponse(signedTransaction.replace('signed-', ''), true);
      },
      finishTransaction: async (transactionId) => {
        finished.push(transactionId);
        return true;
      },
      getAccessToken: async () => accessToken,
      getCurrentEntitlements: async () => [],
      getUnfinishedTransactions: async () => [],
      reconcile: async () => ({ dispositions: [] }),
      sync: async () => undefined,
    });

    const result = await coordinator.handleVerifiedTransaction(transaction('200'));
    expect(result.kind).toBe('BUFFERED');
    expect(coordinator.bufferedCount).toBe(1);
    expect(delivered).toHaveLength(0);

    accessToken = 'access-token';
    await coordinator.flushBuffered();
    expect(delivered).toEqual(['signed-200']);
    expect(finished).toEqual(['200']);
    expect(coordinator.bufferedCount).toBe(0);
  });

  it('never finishes on verification failure, unknown owner, or retryable errors', async () => {
    for (const code of [
      'TRANSACTION_UNVERIFIED',
      'TRANSACTION_OWNER_UNKNOWN',
      'RETRYABLE_CONFLICT',
    ] as const) {
      const harness = createHarness({
        deliver: async () => {
          throw new MobileApiError({ code, message: code, retryable: true });
        },
      });
      const result = await harness.coordinator.handleVerifiedTransaction(transaction('300'));
      expect(result).toEqual({ kind: 'UNFINISHED', reason: code });
      expect(harness.finished).toHaveLength(0);
    }
  });

  it('finishes duplicate and other-owner deliveries the server marks safe', async () => {
    const harness = createHarness({
      deliver: async () => ({
        transactionId: '400',
        deliveryAccepted: true,
        safeToFinish: true,
        appliedNow: false,
        disposition: 'DELIVERED_TO_OTHER_ACCOUNT',
      }),
    });
    const result = await harness.coordinator.handleVerifiedTransaction(transaction('400'));
    expect(result.kind).toBe('DELIVERED');
    expect(harness.finished).toEqual(['400']);
  });

  it('reconciles unfinished and entitlement transactions without prompting', async () => {
    const reconciled: string[][] = [];
    const harness = createHarness({
      unfinished: [transaction('500')],
      entitlements: [transaction('500'), transaction('501')],
      reconcile: async (_token, signedTransactions) => {
        reconciled.push([...signedTransactions]);
        return {
          dispositions: [
            { index: 0, ...acceptedResponse('500', true) },
            { index: 1, ...acceptedResponse('501', false) },
          ],
        };
      },
    });

    await harness.coordinator.reconcileWithServer();

    // Duplicates collapse; only the StoreKit-unfinished item is finished.
    expect(reconciled).toEqual([[transaction('500').signedTransaction, transaction('501').signedTransaction]]);
    expect(harness.finished).toEqual(['500']);
  });

  it('restore purchases syncs explicitly and then reconciles', async () => {
    const harness = createHarness({
      unfinished: [transaction('600')],
      reconcile: async () => ({
        dispositions: [{ index: 0, ...acceptedResponse('600', false) }],
      }),
    });

    await harness.coordinator.restorePurchases();

    expect(harness.synced.count).toBe(1);
    expect(harness.finished).toEqual(['600']);
  });

  it('does nothing on reconcile when no session or no transactions exist', async () => {
    const noSession = createHarness({ accessToken: null });
    expect(await noSession.coordinator.reconcileWithServer()).toBeNull();

    const empty = createHarness();
    expect(await empty.coordinator.reconcileWithServer()).toBeNull();
  });
});
