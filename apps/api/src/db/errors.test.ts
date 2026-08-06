import { describe, expect, it } from 'vitest';

import { DatabaseError, isRetryableTransactionError, mapDatabaseError } from './errors.js';

describe('database error mapping', () => {
  it.each([
    ['P2002', 'UNIQUE_CONSTRAINT'],
    ['P2003', 'FOREIGN_KEY_CONSTRAINT'],
    ['P2004', 'CHECK_CONSTRAINT'],
    ['P2025', 'NOT_FOUND'],
    ['P2034', 'TRANSACTION_CONFLICT'],
    ['P1001', 'UNAVAILABLE'],
  ] as const)('maps Prisma %s to %s', (code, expectedKind) => {
    expect(mapDatabaseError({ code })?.kind).toBe(expectedKind);
  });

  it('finds nested PostgreSQL adapter error codes', () => {
    const result = mapDatabaseError({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    });

    expect(result).toBeInstanceOf(DatabaseError);
    expect(result?.kind).toBe('TRANSACTION_CONFLICT');
    expect(result?.retryable).toBe(true);
    expect(isRetryableTransactionError(result)).toBe(true);
  });

  it('does not disguise unrelated application failures', () => {
    expect(mapDatabaseError(new TypeError('programmer error'))).toBeUndefined();
  });
});
