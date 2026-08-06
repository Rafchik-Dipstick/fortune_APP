import { describe, expect, it } from 'vitest';

import { WriteQueue, getDatabaseWriteQueue } from './write-queue';

describe('WriteQueue', () => {
  it('runs tasks strictly one at a time in submission order', async () => {
    const queue = new WriteQueue();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = queue.run(async () => {
      order.push('first-start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first-end');
    });
    const second = queue.run(() => {
      order.push('second');
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('keeps serving tasks after a failure and propagates the error to its caller only', async () => {
    const queue = new WriteQueue();
    await expect(queue.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('shares one queue per database object', () => {
    const database = {};
    expect(getDatabaseWriteQueue(database)).toBe(getDatabaseWriteQueue(database));
    expect(getDatabaseWriteQueue({})).not.toBe(getDatabaseWriteQueue(database));
  });
});
