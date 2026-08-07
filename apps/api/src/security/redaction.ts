/**
 * One scrubber for everything the process emits about itself.
 *
 * Objective 9 of the trust review says secrets, raw identity proofs, signed
 * transaction payloads, private reading history, and recoverable purchase
 * tokens must not enter logs or analytics (AC-16, AC-20). Path-based redaction
 * alone cannot deliver that, because it only removes the shapes somebody
 * remembered to enumerate. So this module works two ways at once:
 *
 * 1. Key-name redaction removes values whose *name* says they are sensitive.
 * 2. Value-shape redaction removes strings that *look* like a PEM key, a JWS,
 *    a bearer credential, a connection URL, or an unexplained long blob, no
 *    matter which key they arrived under.
 *
 * Everything that survives is additionally length-capped, so a private
 * reading that slips through an unnamed field cannot be reconstructed from a
 * log line.
 */

export const redactedPlaceholder = '[Redacted]';
export const truncatedSuffix = '…[Truncated]';

const maximumStringLength = 256;
const maximumDepth = 6;
const maximumArrayEntries = 32;
const maximumObjectKeys = 64;

/**
 * Key fragments that mark a value as sensitive. Matching is a case-insensitive
 * substring test so `appAccountToken`, `refresh_token`, and `TOKEN` all match
 * one entry. Operationally useful names such as `keyVersion`, `requestId`, and
 * `statusCode` are deliberately absent.
 */
const sensitiveKeyFragments = [
  'affirmation',
  'alias',
  'alttext',
  'apikey',
  'authorization',
  'connectionstring',
  'cookie',
  'credential',
  'databaseurl',
  'displayname',
  'dsn',
  'email',
  'gentleaction',
  'headline',
  'idempotency',
  'passphrase',
  'password',
  'pepper',
  'playerid',
  'privatekey',
  'proof',
  'purchasetoken',
  'salt',
  'secret',
  'signature',
  'signedpayload',
  'signedrenewal',
  'signedtransaction',
  'signingkey',
  'token',
] as const;

/** Value shapes that are sensitive regardless of the key that carried them. */
const sensitiveValuePatterns: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /-----BEGIN CERTIFICATE-----/u,
  // A compact JWS/JWT: two or more base64url segments after a JSON header.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}/iu,
  /\bpostgres(?:ql)?:\/\/[^\s]*:[^\s]*@/iu,
  // An unexplained long opaque blob, e.g. a base64 key or an encrypted payload.
  /\b[A-Za-z0-9+/_-]{80,}={0,2}\b/u,
];

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/gu, '');
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

export function containsSensitiveValue(value: string): boolean {
  return sensitiveValuePatterns.some((pattern) => pattern.test(value));
}

export function scrubString(value: string): string {
  if (containsSensitiveValue(value)) {
    return redactedPlaceholder;
  }
  return value.length > maximumStringLength
    ? `${value.slice(0, maximumStringLength)}${truncatedSuffix}`
    : value;
}

function scrubError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: scrubString(error.message),
    // Frames name files and functions, never argument values, and the message
    // line is scrubbed above before the frames are re-attached.
    stack:
      error.stack === undefined
        ? undefined
        : error.stack
            .split('\n')
            .slice(0, 12)
            .map((line) => (line.trimStart().startsWith('at ') ? line : scrubString(line)))
            .join('\n'),
  };
}

/**
 * Recursively rewrites a value into a form that is safe to log or ship to an
 * error reporter. Structure is preserved so operators keep the shape they need
 * to debug; only the sensitive leaves change.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > maximumDepth) {
    return truncatedSuffix;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return scrubString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return redactedPlaceholder;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    return redactedPlaceholder;
  }
  if (value instanceof Error) {
    return scrubError(value);
  }
  if (Array.isArray(value)) {
    const scrubbed = value
      .slice(0, maximumArrayEntries)
      .map((entry) => scrubValue(entry, depth + 1));
    if (value.length > maximumArrayEntries) {
      scrubbed.push(truncatedSuffix);
    }
    return scrubbed;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, maximumObjectKeys)) {
      result[key] = isSensitiveKey(key) ? redactedPlaceholder : scrubValue(entry, depth + 1);
    }
    return result;
  }
  return redactedPlaceholder;
}

export function scrubLogObject(value: Record<string, unknown>): Record<string, unknown> {
  return scrubValue(value) as Record<string, unknown>;
}
