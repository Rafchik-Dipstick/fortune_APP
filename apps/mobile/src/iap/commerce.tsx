import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IapCallerState, IapCatalogResponse } from '@fortuneness/api-contracts';

import {
  addStorefrontChangeListener,
  addTransactionUpdateListener,
  canMakePayments,
  fetchIapProductsAsync,
  finishIapTransactionAsync,
  getCurrentEntitlementsAsync,
  getIapStorefrontAsync,
  getUnfinishedTransactionsAsync,
  isIapNativeModuleAvailable,
  presentManageSubscriptionsAsync,
  purchaseIapProductAsync,
  restorePurchasesSyncAsync,
  type IapProduct,
  type IapSignedTransaction,
  type IapStorefront,
} from '../../modules/fortuneness-iap';
import { useAuthentication } from '../auth/authentication';
import {
  deliverIapTransaction,
  getIapCatalog,
  getIapStatus,
  MobileApiError,
  reconcileIapTransactions,
} from '../auth/api-client';
import { fortuneStateQueryKey } from '../fortune/fortune-ritual';
import { CommerceDeliveryCoordinator, type DeliverableTransaction } from './commerce-delivery';
import {
  buildShopOffers,
  deliveryFailureMessage,
  describeDelivery,
  mapPurchaseResult,
  summarizeRestore,
  type RestoreSummary,
  type ShopOffer,
  type ShopPurchasePhase,
} from './shop-catalog';

interface CommerceContextValue {
  callerState: IapCallerState | undefined;
  catalog: IapCatalogResponse | undefined;
  catalogError: Error | undefined;
  isCatalogLoading: boolean;
  isRestoring: boolean;
  manageError: string | undefined;
  offers: ShopOffer[];
  purchasePhase: ShopPurchasePhase;
  restoreSummary: RestoreSummary | undefined;
  storefront: IapStorefront | null;
  storeKitAvailable: boolean;
  acknowledgePurchasePhase: () => void;
  manageSubscription: () => Promise<void>;
  purchase: (productId: string) => Promise<void>;
  restorePurchases: () => Promise<void>;
  retryCatalog: () => Promise<void>;
}

const CommerceContext = createContext<CommerceContextValue | undefined>(undefined);

export const iapCatalogQueryKey = (accountId: string) => ['iap', 'catalog', accountId] as const;
export const iapStatusQueryKey = (accountId: string) => ['iap', 'status', accountId] as const;
export const iapProductsQueryKey = (accountId: string, storefrontId: string, productIds: string) =>
  ['iap', 'products', accountId, storefrontId, productIds] as const;

function toDeliverable(transaction: IapSignedTransaction): DeliverableTransaction {
  return {
    signedTransaction: transaction.signedTransaction,
    transactionId: transaction.transactionId,
  };
}

function failureReason(error: unknown): string {
  return error instanceof MobileApiError ? error.code : 'UNKNOWN';
}

export function CommerceProvider({ children }: { children: ReactNode }) {
  const authentication = useAuthentication();
  const queryClient = useQueryClient();
  if (authentication.phase !== 'AUTHENTICATED' || authentication.session === undefined) {
    throw new Error('CommerceProvider requires an authenticated session.');
  }
  const session = authentication.session;
  const accountId = session.user.id;
  const accessToken = useRef(session.accessToken);
  const [purchasePhase, setPurchasePhase] = useState<ShopPurchasePhase>({ kind: 'IDLE' });
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary>();
  const [isRestoring, setIsRestoring] = useState(false);
  const [manageError, setManageError] = useState<string>();
  const [storefront, setStorefront] = useState<IapStorefront | null>(null);
  const storeKitAvailable = useMemo(isIapNativeModuleAvailable, []);
  const paymentsAllowed = useMemo(canMakePayments, []);

  useEffect(() => {
    accessToken.current = session.accessToken;
  }, [session.accessToken]);

  // Recreated per account so a transaction buffered before an account switch
  // is never quietly attributed to the next player's session.
  const coordinator = useMemo(
    () =>
      new CommerceDeliveryCoordinator({
        deliver: (token, signedTransaction) => deliverIapTransaction(token, signedTransaction),
        finishTransaction: finishIapTransactionAsync,
        getAccessToken: () => Promise.resolve(accessToken.current),
        getCurrentEntitlements: async () =>
          (await getCurrentEntitlementsAsync()).map(toDeliverable),
        getUnfinishedTransactions: async () =>
          (await getUnfinishedTransactionsAsync()).map(toDeliverable),
        reconcile: (token, signedTransactions) =>
          reconcileIapTransactions(token, signedTransactions),
        sync: restorePurchasesSyncAsync,
      }),
    [accountId],
  );

  const catalogQuery = useQuery({
    queryKey: iapCatalogQueryKey(accountId),
    queryFn: () => getIapCatalog(accessToken.current),
  });
  const statusQuery = useQuery({
    queryKey: iapStatusQueryKey(accountId),
    queryFn: () => getIapStatus(accessToken.current),
  });

  const productIds = useMemo(
    () => (catalogQuery.data?.products ?? []).map((product) => product.productId).sort(),
    [catalogQuery.data],
  );
  const productsQuery = useQuery({
    queryKey: iapProductsQueryKey(accountId, storefront?.id ?? 'unknown', productIds.join(',')),
    queryFn: (): Promise<IapProduct[]> => fetchIapProductsAsync([...productIds]),
    enabled: productIds.length > 0 && storeKitAvailable,
  });

  const applyCallerState = useCallback(
    (state: IapCallerState | undefined) => {
      if (state !== undefined) {
        queryClient.setQueryData(iapStatusQueryKey(accountId), state);
      }
    },
    [accountId, queryClient],
  );

  /** Quotas must update without restarting the app (Phase 10 acceptance). */
  const refreshEntitlements = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: iapStatusQueryKey(accountId) }),
      queryClient.invalidateQueries({ queryKey: fortuneStateQueryKey(accountId) }),
    ]);
  }, [accountId, queryClient]);

  // Verified updates arriving outside a purchase tap: Ask to Buy approvals,
  // renewals, and anything StoreKit replays after a relaunch.
  useEffect(() => {
    const subscription = addTransactionUpdateListener((transaction) => {
      void coordinator
        .handleVerifiedTransaction(toDeliverable(transaction))
        .then(async (result) => {
          if (result.kind === 'DELIVERED') {
            if ('callerState' in result.response) {
              applyCallerState(result.response.callerState);
            }
            await refreshEntitlements();
          }
        })
        .catch(() => undefined);
    });
    return () => {
      subscription.remove();
    };
  }, [applyCallerState, coordinator, refreshEntitlements]);

  // Launch reconciliation never calls AppStore.sync(); it only enumerates what
  // StoreKit already holds for this device.
  useEffect(() => {
    let active = true;
    void coordinator
      .reconcileWithServer()
      .then(async (response) => {
        if (active && response !== null) {
          applyCallerState(response.callerState);
          await refreshEntitlements();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [applyCallerState, coordinator, refreshEntitlements]);

  useEffect(() => {
    let active = true;
    void getIapStorefrontAsync()
      .then((current) => {
        if (active) {
          setStorefront(current);
        }
      })
      .catch(() => undefined);
    const subscription = addStorefrontChangeListener((next) => {
      setStorefront(next);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const purchase = useCallback(
    async (productId: string) => {
      const catalog = catalogQuery.data;
      if (catalog === undefined) {
        setPurchasePhase({
          kind: 'FAILED',
          productId,
          message:
            'Fortuneness could not load what this product grants, so no purchase was started and nothing was charged.',
        });
        return;
      }
      setRestoreSummary(undefined);
      setManageError(undefined);
      setPurchasePhase({ kind: 'PURCHASING', productId });
      try {
        const result = await purchaseIapProductAsync(productId, catalog.appAccountToken);
        const phase = mapPurchaseResult(productId, result);
        if (phase.kind !== 'PURCHASING' || result.transaction === null) {
          setPurchasePhase(phase);
          return;
        }
        const delivery = await coordinator.handleVerifiedTransaction(
          toDeliverable(result.transaction),
        );
        if (delivery.kind === 'DELIVERED') {
          setPurchasePhase(
            describeDelivery(
              productId,
              delivery.response.disposition,
              catalog.benefits.find((benefit) => benefit.productId === productId),
            ),
          );
          if ('callerState' in delivery.response) {
            applyCallerState(delivery.response.callerState);
          }
          await refreshEntitlements();
          return;
        }
        setPurchasePhase({
          kind: 'FAILED',
          productId,
          message:
            delivery.kind === 'BUFFERED'
              ? deliveryFailureMessage('NETWORK_UNAVAILABLE')
              : deliveryFailureMessage(delivery.reason),
        });
      } catch (error) {
        setPurchasePhase({
          kind: 'FAILED',
          productId,
          message: deliveryFailureMessage(failureReason(error)),
        });
      }
    },
    [applyCallerState, catalogQuery.data, coordinator, refreshEntitlements],
  );

  const restorePurchases = useCallback(async () => {
    setPurchasePhase({ kind: 'IDLE' });
    setManageError(undefined);
    setRestoreSummary(undefined);
    setIsRestoring(true);
    try {
      const response = await coordinator.restorePurchases();
      applyCallerState(response?.callerState);
      setRestoreSummary(
        summarizeRestore(response?.dispositions, response?.callerState ?? statusQuery.data),
      );
      await refreshEntitlements();
    } catch (error) {
      setRestoreSummary({
        accepted: 0,
        rejected: 0,
        message:
          failureReason(error) === 'NETWORK_UNAVAILABLE'
            ? 'Restore Purchases needs a connection to recheck your Apple purchases. Nothing was charged or changed.'
            : 'Restore Purchases could not finish. Nothing was charged or changed; try again in a moment.',
      });
    } finally {
      setIsRestoring(false);
    }
  }, [applyCallerState, coordinator, refreshEntitlements, statusQuery.data]);

  const manageSubscription = useCallback(async () => {
    setManageError(undefined);
    try {
      await presentManageSubscriptionsAsync();
      await refreshEntitlements();
    } catch {
      setManageError(
        'The Apple subscription settings could not be opened here. You can manage Oracle+ in Settings › Apple Account › Subscriptions.',
      );
    }
  }, [refreshEntitlements]);

  const retryCatalog = useCallback(async () => {
    await Promise.all([catalogQuery.refetch(), statusQuery.refetch(), productsQuery.refetch()]);
  }, [catalogQuery, productsQuery, statusQuery]);

  const acknowledgePurchasePhase = useCallback(() => {
    setPurchasePhase({ kind: 'IDLE' });
    setRestoreSummary(undefined);
  }, []);

  const offers = useMemo(
    () =>
      catalogQuery.data === undefined
        ? []
        : buildShopOffers({
            callerState: statusQuery.data,
            canMakePayments: paymentsAllowed,
            catalog: catalogQuery.data,
            products: productsQuery.data ?? [],
            purchasePhase,
            storeKitAvailable,
          }),
    [
      catalogQuery.data,
      paymentsAllowed,
      productsQuery.data,
      purchasePhase,
      statusQuery.data,
      storeKitAvailable,
    ],
  );

  const value = useMemo<CommerceContextValue>(
    () => ({
      acknowledgePurchasePhase,
      callerState: statusQuery.data,
      catalog: catalogQuery.data,
      catalogError: catalogQuery.error ?? undefined,
      isCatalogLoading:
        catalogQuery.isPending ||
        (productsQuery.isPending && productIds.length > 0 && storeKitAvailable),
      isRestoring,
      manageError,
      manageSubscription,
      offers,
      purchase,
      purchasePhase,
      restorePurchases,
      restoreSummary,
      retryCatalog,
      storeKitAvailable,
      storefront,
    }),
    [
      acknowledgePurchasePhase,
      catalogQuery.data,
      catalogQuery.error,
      catalogQuery.isPending,
      isRestoring,
      manageError,
      manageSubscription,
      offers,
      productIds.length,
      productsQuery.isPending,
      purchase,
      purchasePhase,
      restorePurchases,
      restoreSummary,
      retryCatalog,
      statusQuery.data,
      storeKitAvailable,
      storefront,
    ],
  );

  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>;
}

export function useCommerce(): CommerceContextValue {
  const value = useContext(CommerceContext);
  if (value === undefined) {
    throw new Error('useCommerce must be used inside CommerceProvider.');
  }
  return value;
}
