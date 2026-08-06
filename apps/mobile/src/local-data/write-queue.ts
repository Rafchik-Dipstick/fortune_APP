/**
 * Serializes application-level writes to one SQLite database. expo-sqlite runs
 * exclusive transactions on a second connection and colliding writers abort
 * with "database is locked" instead of waiting, so every store write path runs
 * through the shared per-database queue. Queued tasks must never enqueue
 * further work on the same queue, or they would wait on themselves.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const queues = new WeakMap<object, WriteQueue>();

export function getDatabaseWriteQueue(database: object): WriteQueue {
  let queue = queues.get(database);
  if (queue === undefined) {
    queue = new WriteQueue();
    queues.set(database, queue);
  }
  return queue;
}
