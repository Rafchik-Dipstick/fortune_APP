import { describe, expect, it } from 'vitest';

import { bumpAccountPurgeEpoch, getAccountPurgeEpoch } from './purge-epoch';

describe('purge epoch registry', () => {
  it('increments per (database, account) and leaves other accounts untouched', () => {
    const database = {};
    expect(getAccountPurgeEpoch(database, 'account-a')).toBe(0);

    bumpAccountPurgeEpoch(database, 'account-a');
    bumpAccountPurgeEpoch(database, 'account-a');

    expect(getAccountPurgeEpoch(database, 'account-a')).toBe(2);
    expect(getAccountPurgeEpoch(database, 'account-b')).toBe(0);
    expect(getAccountPurgeEpoch({}, 'account-a')).toBe(0);
  });
});
