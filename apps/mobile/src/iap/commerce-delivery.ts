import { type IapReconcileResponse, type IapTransactionResponse } from '@fortuneness/api-contracts';

import { MobileApiError } from '../auth/api-client';

export interface DeliverableTransaction {
  signedTransaction: string;
  transactionId: string;
}

/**
 * Dependencies are injected so the coordinator is testable without StoreKit
 * or the network. `getAccessToken` returns null until an account/bootstrap
 * decision exists; deliveries buffer until then.
 */
export interface CommerceDeliveryDependencies {
  deliver(accessToken: string, signedTransaction: string): Promise<IapTransactionResponse>;
  finishTransaction(transactionId: string): Promise<boolean>;
  getAccessToken(): Promise<string | null>;
  getCurrentEntitlements(): Promise<DeliverableTransaction[]>;
  getUnfinishedTransactions(): Promise<DeliverableTransaction[]>;
  reconcile(
    accessToken: string,
    signedTransactions: readonly string[],
  ): Promise<IapReconcileResponse>;
  /** Explicit Restore Purchases only: AppStore.sync(). */
  sync(): Promise<void>;
}

export type DeliveryResult =
  | { kind: 'BUFFERED' }
  | { kind: 'DELIVERED'; response: IapTransactionResponse }
  | { kind: 'UNFINISHED'; reason: string };

const reconcileBatchLimit = 100;

/**
 * Client side of the exactly-once delivery loop (spec section 7.2). Every
 * path — live updates, unfinished enumeration, launch reconcile, and
 * explicit restore — feeds the same idempotent server application, and a
 * StoreKit transaction is finished only after the server confirms
 * `deliveryAccepted` and `safeToFinish`. Killing the app at any step loses
 * nothing: unfinished transactions resurface on the next launch.
 */
export class CommerceDeliveryCoordinator {
  private readonly buffered = new Map<string, DeliverableTransaction>();
  private readonly dependencies: CommerceDeliveryDependencies;

  constructor(dependencies: CommerceDeliveryDependencies) {
    this.dependencies = dependencies;
  }

  /** Number of transactions waiting for an account decision. */
  get bufferedCount(): number {
    return this.buffered.size;
  }

  /**
   * Handles one verified transaction from the launch-time updates listener
   * or a completed purchase. Buffers when no session exists yet.
   */
  async handleVerifiedTransaction(transaction: DeliverableTransaction): Promise<DeliveryResult> {
    const accessToken = await this.dependencies.getAccessToken();
    if (accessToken === null) {
      this.buffered.set(transaction.transactionId, transaction);
      return { kind: 'BUFFERED' };
    }
    return this.deliverOne(accessToken, transaction);
  }

  /** Delivers everything buffered while no account decision existed. */
  async flushBuffered(): Promise<void> {
    const accessToken = await this.dependencies.getAccessToken();
    if (accessToken === null) {
      return;
    }
    const pending = [...this.buffered.values()];
    this.buffered.clear();
    for (const transaction of pending) {
      await this.deliverOne(accessToken, transaction);
    }
  }

  /**
   * Post-bootstrap reconciliation: enumerates unfinished transactions and
   * current entitlements without prompting and reconciles them with the
   * server, finishing only what the server marks safe.
   */
  async reconcileWithServer(): Promise<IapReconcileResponse | null> {
    const accessToken = await this.dependencies.getAccessToken();
    if (accessToken === null) {
      return null;
    }

    const [unfinished, entitlements] = await Promise.all([
      this.dependencies.getUnfinishedTransactions(),
      this.dependencies.getCurrentEntitlements(),
    ]);
    const byTransactionId = new Map<string, DeliverableTransaction>();
    for (const transaction of [...unfinished, ...entitlements]) {
      byTransactionId.set(transaction.transactionId, transaction);
    }
    if (byTransactionId.size === 0) {
      return null;
    }

    const items = [...byTransactionId.values()].slice(0, reconcileBatchLimit);
    const response = await this.dependencies.reconcile(
      accessToken,
      items.map((item) => item.signedTransaction),
    );

    const unfinishedIds = new Set(unfinished.map((transaction) => transaction.transactionId));
    for (const disposition of response.dispositions) {
      // Accepted dispositions are safe to finish by contract; rejected items
      // stay unfinished for a later attempt or support resolution.
      if (disposition.deliveryAccepted && unfinishedIds.has(disposition.transactionId)) {
        await this.dependencies.finishTransaction(disposition.transactionId);
      }
    }
    return response;
  }

  /**
   * Explicit player-tapped Restore Purchases: calls AppStore.sync(), then
   * re-enumerates and reconciles. Never invoked on normal launch.
   */
  async restorePurchases(): Promise<IapReconcileResponse | null> {
    await this.dependencies.sync();
    return this.reconcileWithServer();
  }

  private async deliverOne(
    accessToken: string,
    transaction: DeliverableTransaction,
  ): Promise<DeliveryResult> {
    try {
      const response = await this.dependencies.deliver(accessToken, transaction.signedTransaction);
      // Every accepted delivery shape carries safeToFinish: true; anything
      // unsafe surfaces as a typed error instead of a success response.
      await this.dependencies.finishTransaction(transaction.transactionId);
      return { kind: 'DELIVERED', response };
    } catch (error) {
      // Verification failure, unknown ownership, and retryable server
      // failure all leave the StoreKit transaction unfinished; it will
      // resurface through Transaction.unfinished on the next attempt.
      if (error instanceof MobileApiError) {
        return { kind: 'UNFINISHED', reason: error.code };
      }
      throw error;
    }
  }
}
