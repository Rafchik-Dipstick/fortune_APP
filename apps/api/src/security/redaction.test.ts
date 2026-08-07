import { describe, expect, it } from 'vitest';

import {
  containsSensitiveValue,
  isSensitiveKey,
  redactedPlaceholder,
  scrubString,
  scrubValue,
} from './redaction.js';

const signedJws =
  'eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlF' +
  'Q0RDQ0F2Q2dBd0lCQWdJUUZ' +
  '.eyJ0cmFuc2FjdGlvbklkIjoiMjAwMDAwMDAwMDAwMDAwMSJ9' +
  '.7hV0Xk3sQm1oQ2c';

describe('sensitive key detection', () => {
  it.each([
    'authorization',
    'Authorization',
    'refresh_token',
    'refreshToken',
    'appAccountToken',
    'purchaseToken',
    'signedPayload',
    'signedTransactionInfo',
    'signedRenewalInfos',
    'gameCenterSignature',
    'proofSalt',
    'DATABASE_URL',
    'privateKeyPem',
    'idempotencyKey',
    'playerId',
    'gamePlayerID',
    'displayName',
    'alias',
    'headline',
    'affirmation',
    'gentleAction',
    'altText',
    'errorReportingDsn',
  ])('treats %s as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'requestId',
    'statusCode',
    'durationMs',
    'keyVersion',
    'method',
    'path',
    'allowanceSource',
    'intention',
    'notificationType',
    'productId',
    'jobName',
    'errorName',
  ])('keeps %s, which operators need', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('sensitive value detection', () => {
  it.each([
    ['a PEM private key', '-----BEGIN PRIVATE KEY-----\nMIGHAgEA\n-----END PRIVATE KEY-----'],
    ['a PEM certificate', '-----BEGIN CERTIFICATE-----\nMIIEXjCC\n-----END CERTIFICATE-----'],
    ['a compact JWS', signedJws],
    ['a bearer credential', 'Bearer abcdefghijklmnopqrstuvwxyz012345'],
    [
      'a database URL with a password',
      'postgresql://postgres:hunter2@db.internal:5432/fortuneness',
    ],
    ['an unexplained long blob', 'A'.repeat(96)],
  ])('redacts %s wherever it appears', (_description, value) => {
    expect(containsSensitiveValue(value)).toBe(true);
    expect(scrubString(value)).toBe(redactedPlaceholder);
    expect(scrubValue({ harmlessLookingField: value })).toEqual({
      harmlessLookingField: redactedPlaceholder,
    });
  });

  it('keeps ordinary operational strings intact', () => {
    for (const value of [
      'fortune_draw_issued',
      'app.fortuneness.fortunepack10',
      'DID_RENEW',
      '2026-08-07',
      '9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c',
    ]) {
      expect(scrubString(value)).toBe(value);
    }
  });

  it('caps a long but unremarkable string instead of publishing all of it', () => {
    const fortuneBody = 'The lantern you carry is enough for the next step. '.repeat(20);
    const scrubbed = scrubString(fortuneBody);

    expect(scrubbed.length).toBeLessThan(fortuneBody.length);
    expect(scrubbed.endsWith('…[Truncated]')).toBe(true);
  });
});

describe('structural scrubbing', () => {
  it('removes sensitive leaves at every depth while preserving shape', () => {
    const scrubbed = scrubValue({
      requestId: '9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c',
      session: {
        refreshToken: 'rt_live_9f1c0a7e2b3d4f5a',
        family: { id: 'family-1', accessToken: 'at_live_abc' },
      },
      commerce: {
        productId: 'app.fortuneness.oracleplus.monthly',
        transactions: [{ signedTransactionInfo: signedJws, transactionId: '2000000000000001' }],
      },
    });

    expect(scrubbed).toEqual({
      requestId: '9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c',
      session: {
        refreshToken: redactedPlaceholder,
        family: { id: 'family-1', accessToken: redactedPlaceholder },
      },
      commerce: {
        productId: 'app.fortuneness.oracleplus.monthly',
        transactions: [
          { signedTransactionInfo: redactedPlaceholder, transactionId: '2000000000000001' },
        ],
      },
    });
  });

  it('redacts binary payloads rather than hex-dumping them', () => {
    expect(scrubValue({ ciphertext: Buffer.from('secret bytes') })).toEqual({
      ciphertext: redactedPlaceholder,
    });
  });

  it('bounds recursion, array width, and object width', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 'too deep' } } } } } } } };
    expect(JSON.stringify(scrubValue(deep))).toContain('Truncated');

    const wide = scrubValue(Array.from({ length: 100 }, (_value, index) => index)) as unknown[];
    expect(wide.length).toBe(33);
    expect(wide.at(-1)).toBe('…[Truncated]');
  });

  it('keeps an error debuggable while scrubbing its message', () => {
    const error = new Error(`verification failed for ${signedJws}`);
    const scrubbed = scrubValue(error) as { message: string; name: string; stack: string };

    expect(scrubbed.name).toBe('Error');
    expect(scrubbed.message).toBe(redactedPlaceholder);
    expect(scrubbed.stack).toContain('at ');
    expect(scrubbed.stack).not.toContain(signedJws);
  });

  it('survives cycles-free exotic values without throwing', () => {
    expect(scrubValue(undefined)).toBeUndefined();
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(10n)).toBe('10');
    expect(scrubValue(() => undefined)).toBe(redactedPlaceholder);
    expect(scrubValue(Symbol('s'))).toBe(redactedPlaceholder);
    expect(scrubValue(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07T00:00:00.000Z');
  });
});
