/**
 * In-memory purge generation per (database, account). Long-lived writers (the
 * baseline sync, query persistence) capture the epoch before they start and
 * drop their writes if a purge bumped it meanwhile, so a signed-out account's
 * data is never re-inserted after `purgeAccount` ran. The bump happens
 * synchronously when the purge is requested — before its queued delete runs —
 * so an epoch check immediately followed by an enqueued write cannot interleave
 * with a purge.
 */
const registries = new WeakMap<object, Map<string, number>>();

function registry(database: object): Map<string, number> {
  let epochs = registries.get(database);
  if (epochs === undefined) {
    epochs = new Map();
    registries.set(database, epochs);
  }
  return epochs;
}

export function getAccountPurgeEpoch(database: object, accountId: string): number {
  return registry(database).get(accountId) ?? 0;
}

export function bumpAccountPurgeEpoch(database: object, accountId: string): void {
  const epochs = registry(database);
  epochs.set(accountId, (epochs.get(accountId) ?? 0) + 1);
}
