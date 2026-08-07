import { type AccountPurgeWorker } from '../account/purge.js';
import { type ApiLogger } from '../logging/logger.js';
import { type AppStoreNotificationWorker } from './notifications.js';
import { type AppStoreReconciliationJob } from './reconciliation.js';

export interface CommerceBackgroundJobs {
  start(): void;
  stop(): Promise<void>;
}

interface CommerceBackgroundJobOptions {
  accountPurge?: AccountPurgeWorker;
  accountPurgeIntervalMs?: number;
  logger: ApiLogger;
  notificationIntervalMs?: number;
  reconciliation?: AppStoreReconciliationJob;
  reconciliationIntervalMs?: number;
  worker: AppStoreNotificationWorker;
}

/**
 * In-process schedulers for the durable notification worker and the
 * distributed-locked reconciliation job. Ticks never overlap themselves, and
 * a failed tick logs and waits for the next interval rather than crashing.
 */
export function createCommerceBackgroundJobs(
  options: CommerceBackgroundJobOptions,
): CommerceBackgroundJobs {
  const notificationIntervalMs = options.notificationIntervalMs ?? 5_000;
  const reconciliationIntervalMs = options.reconciliationIntervalMs ?? 6 * 3_600_000;
  const accountPurgeIntervalMs = options.accountPurgeIntervalMs ?? 3_600_000;
  const timers: NodeJS.Timeout[] = [];
  let running = false;
  let activeTick: Promise<void> = Promise.resolve();

  const guard =
    (name: string, tick: () => Promise<unknown>): (() => void) =>
    () => {
      activeTick = activeTick.then(async () => {
        if (!running) {
          return;
        }
        try {
          await tick();
        } catch (error) {
          options.logger.warn(
            { jobName: name, errorName: error instanceof Error ? error.name : 'unknown' },
            'Commerce background job tick failed',
          );
        }
      });
    };

  return {
    start: () => {
      if (running) {
        return;
      }
      running = true;
      const notificationTick = guard('app-store-notifications', async () => {
        await options.worker.runOnce();
        await options.worker.purgeExpiredPayloads();
      });
      timers.push(setInterval(notificationTick, notificationIntervalMs));
      if (options.reconciliation !== undefined) {
        const reconciliation = options.reconciliation;
        const reconciliationTick = guard('app-store-reconciliation', () =>
          reconciliation.runOnce(),
        );
        timers.push(setInterval(reconciliationTick, reconciliationIntervalMs));
      }
      if (options.accountPurge !== undefined) {
        const accountPurge = options.accountPurge;
        const purgeTick = guard('account-purge', async () => {
          const result = await accountPurge.run();
          if (result.purgedUserIds.length > 0) {
            options.logger.info(
              { jobName: 'account-purge', purged: result.purgedUserIds.length },
              'Completed scheduled account purges',
            );
          }
        });
        timers.push(setInterval(purgeTick, accountPurgeIntervalMs));
      }
      for (const timer of timers) {
        timer.unref();
      }
    },
    stop: async () => {
      running = false;
      for (const timer of timers) {
        clearInterval(timer);
      }
      timers.length = 0;
      await activeTick;
    },
  };
}
