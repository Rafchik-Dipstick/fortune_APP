import { describe, expect, it } from 'vitest';
import { opaqueCursorSchema } from '@fortuneness/api-contracts';

import { type VersionedKeyRing } from '../config/environment.js';
import { decodeArchiveCursor, encodeArchiveCursor } from './archive-cursor.js';

const keyRing: VersionedKeyRing = {
  currentVersion: 'v2',
  keys: { v1: Buffer.alloc(32, 1), v2: Buffer.alloc(32, 2) },
};

const scope = {
  filters: { intention: 'GROWTH', orientation: undefined },
  keyRing,
  scope: '/v1/fortunes',
  userId: '11111111-1111-4111-8111-111111111111',
};

const position = {
  id: '44444444-4444-4444-8444-444444444444',
  issuedAt: new Date('2026-08-06T10:00:00.000Z'),
};

describe('archive cursor', () => {
  it('round-trips a contract-shaped signed cursor bound to user, scope, and filters', () => {
    const cursor = encodeArchiveCursor(scope, position);

    expect(opaqueCursorSchema.safeParse(cursor).success).toBe(true);
    expect(decodeArchiveCursor(scope, cursor)).toEqual(position);
  });

  it('treats undefined filters and absent filters as the same binding', () => {
    const cursor = encodeArchiveCursor(scope, position);

    expect(decodeArchiveCursor({ ...scope, filters: { intention: 'GROWTH' } }, cursor)).toEqual(
      position,
    );
  });

  it('rejects a cursor presented by another user, scope, or filter set', () => {
    const cursor = encodeArchiveCursor(scope, position);

    expect(
      decodeArchiveCursor({ ...scope, userId: '99999999-9999-4999-8999-999999999999' }, cursor),
    ).toBeUndefined();
    expect(decodeArchiveCursor({ ...scope, scope: '/v1/collection/cards/:key' }, cursor)).toBe(
      undefined,
    );
    expect(
      decodeArchiveCursor({ ...scope, filters: { intention: 'LOVE' } }, cursor),
    ).toBeUndefined();
    expect(decodeArchiveCursor({ ...scope, filters: {} }, cursor)).toBeUndefined();
  });

  it('rejects tampered payloads, signatures, and malformed cursors', () => {
    const cursor = encodeArchiveCursor(scope, position);
    const [version, payload, signature] = cursor.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ v: 'v2', a: '2026-08-05T10:00:00.000Z', i: position.id }),
    ).toString('base64url');

    expect(decodeArchiveCursor(scope, `${version}.${forgedPayload}.${signature}`)).toBeUndefined();
    expect(decodeArchiveCursor(scope, `${version}.${payload}.AAAA`)).toBeUndefined();
    expect(decodeArchiveCursor(scope, `v2.${payload}.${signature}`)).toBeUndefined();
    expect(decodeArchiveCursor(scope, 'not-a-cursor')).toBeUndefined();
    expect(decodeArchiveCursor(scope, `${version}.${payload}`)).toBeUndefined();
    expect(
      decodeArchiveCursor(
        scope,
        `${version}.${Buffer.from('[]').toString('base64url')}.${signature}`,
      ),
    ).toBeUndefined();
  });

  it('verifies cursors signed with a rotated-out-but-retained key version', () => {
    const oldRing: VersionedKeyRing = { currentVersion: 'v1', keys: { v1: Buffer.alloc(32, 1) } };
    const cursor = encodeArchiveCursor({ ...scope, keyRing: oldRing }, position);

    expect(decodeArchiveCursor(scope, cursor)).toEqual(position);
  });

  it('rejects cursors naming an unknown key version', () => {
    const foreignRing: VersionedKeyRing = {
      currentVersion: 'v9',
      keys: { v9: Buffer.alloc(32, 9) },
    };
    const cursor = encodeArchiveCursor({ ...scope, keyRing: foreignRing }, position);

    expect(decodeArchiveCursor(scope, cursor)).toBeUndefined();
  });

  it('rejects cursors naming Object.prototype members as key versions without throwing', () => {
    for (const version of ['constructor', 'valueOf', 'toString', 'hasOwnProperty']) {
      const payload = Buffer.from(
        JSON.stringify({ v: version, a: '2026-08-06T10:00:00.000Z', i: position.id }),
      ).toString('base64url');

      expect(decodeArchiveCursor(scope, `v1.${payload}.AAAA`)).toBeUndefined();
    }
  });

  it('refuses to encode when the current key version only matches a prototype member', () => {
    const poisonedRing = {
      currentVersion: 'constructor',
      keys: { v1: Buffer.alloc(32, 1) },
    } as unknown as VersionedKeyRing;

    expect(() => encodeArchiveCursor({ ...scope, keyRing: poisonedRing }, position)).toThrow(
      'Current archive cursor key is unavailable.',
    );
  });
});
