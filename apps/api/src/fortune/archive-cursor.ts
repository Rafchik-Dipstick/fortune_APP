import { createHmac } from 'node:crypto';

import { z } from 'zod';

import { type VersionedKeyRing } from '../config/environment.js';
import { constantTimeEqual } from '../security/crypto.js';

const cursorVersion = 'v1';

const cursorPayloadSchema = z
  .object({
    v: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
    a: z.iso.datetime(),
    i: z.uuid(),
  })
  .strict();

export interface ArchiveCursorPosition {
  id: string;
  issuedAt: Date;
}

export interface ArchiveCursorScope {
  filters: Readonly<Record<string, string | undefined>>;
  keyRing: VersionedKeyRing;
  scope: string;
  userId: string;
}

function canonicalContext(options: ArchiveCursorScope, payloadSegment: string): string {
  const normalizedFilters = Object.entries(options.filters)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  return [cursorVersion, payloadSegment, options.userId, options.scope, normalizedFilters].join(
    '\n',
  );
}

function signContext(context: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(context, 'utf8').digest();
}

function lookupKey(keys: Readonly<Record<string, Buffer>>, version: string): Buffer | undefined {
  // Own-property check: version strings such as "constructor" must not
  // resolve to inherited Object.prototype members.
  return Object.hasOwn(keys, version) ? keys[version] : undefined;
}

export function encodeArchiveCursor(
  options: ArchiveCursorScope,
  position: ArchiveCursorPosition,
): string {
  const key = lookupKey(options.keyRing.keys, options.keyRing.currentVersion);
  if (key === undefined) {
    throw new Error('Current archive cursor key is unavailable.');
  }
  const payloadSegment = Buffer.from(
    JSON.stringify({
      v: options.keyRing.currentVersion,
      a: position.issuedAt.toISOString(),
      i: position.id,
    }),
    'utf8',
  ).toString('base64url');
  const signature = signContext(canonicalContext(options, payloadSegment), key).toString(
    'base64url',
  );
  return `${cursorVersion}.${payloadSegment}.${signature}`;
}

export function decodeArchiveCursor(
  options: ArchiveCursorScope,
  cursor: string,
): ArchiveCursorPosition | undefined {
  const segments = cursor.split('.');
  if (segments.length !== 3 || segments[0] !== cursorVersion) {
    return undefined;
  }
  const [, payloadSegment, signatureSegment] = segments;
  if (payloadSegment === undefined || signatureSegment === undefined) {
    return undefined;
  }

  let payload: z.infer<typeof cursorPayloadSchema>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    const result = cursorPayloadSchema.safeParse(parsed);
    if (!result.success) {
      return undefined;
    }
    payload = result.data;
  } catch {
    return undefined;
  }

  const key = lookupKey(options.keyRing.keys, payload.v);
  if (key === undefined) {
    return undefined;
  }
  const expected = signContext(canonicalContext(options, payloadSegment), key);
  let presented: Buffer;
  try {
    presented = Buffer.from(signatureSegment, 'base64url');
  } catch {
    return undefined;
  }
  if (!constantTimeEqual(expected, presented)) {
    return undefined;
  }
  return { id: payload.i, issuedAt: new Date(payload.a) };
}
