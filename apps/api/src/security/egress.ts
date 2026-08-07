import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

/**
 * The single outbound HTTPS boundary for the API process.
 *
 * Every server-initiated request — Game Center public keys, Apple certificate
 * issuers, the App Store Server API, and error reporting — passes through this
 * guard so one implementation owns the SSRF controls the trust review requires
 * (AC-01, AC-20): HTTPS only, an exact host allowlist, no credentials, ports,
 * or fragments, DNS results that must resolve exclusively to public addresses,
 * connection pinned to a validated address with the original hostname as SNI,
 * a hard response-size ceiling, and a bounded deadline.
 *
 * `node:https` does not follow redirects, so a 3xx never silently escapes the
 * allowlist; callers see the redirect status and decide, and any caller that
 * chooses to follow one must re-enter this guard with the new URL.
 */

export type EgressDenialReason =
  | 'HOST_NOT_ALLOWED'
  | 'HOST_UNRESOLVED'
  | 'PRIVATE_ADDRESS'
  | 'RESPONSE_TOO_LARGE'
  | 'URL_NOT_ALLOWED';

export class EgressDeniedError extends Error {
  readonly reason: EgressDenialReason;

  constructor(reason: EgressDenialReason, message: string) {
    super(message);
    this.name = 'EgressDeniedError';
    this.reason = reason;
  }
}

export type AddressLookup = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

export interface EgressRequest {
  allowedHosts: readonly string[];
  body?: Buffer | string;
  headers?: Readonly<Record<string, string>>;
  lookup?: AddressLookup;
  maxResponseBytes: number;
  method: 'GET' | 'POST' | 'PUT';
  timeoutMs: number;
  url: string;
}

export interface EgressResponse {
  body: Buffer;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  statusCode: number;
}

/**
 * Classifies an already-parsed IP literal as globally routable. Loopback,
 * private, carrier-grade NAT, link-local (including the cloud metadata
 * address), documentation, and multicast ranges are all denied so a hostile
 * or hijacked DNS answer cannot point the process at internal infrastructure.
 */
export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const first = parts[0] ?? 0;
    const second = parts[1] ?? 0;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19 || second === 51)) ||
      (first === 203 && second === 0 && (parts[2] ?? 0) === 113) ||
      first >= 224
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      return isPublicNetworkAddress(normalized.slice('::ffff:'.length));
    }
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }
  return false;
}

/**
 * Accepts only an exact-match HTTPS origin from the allowlist. Suffix matching
 * is deliberately absent: `static.gc.apple.com.attacker.example` must fail.
 */
export function assertAllowedEgressUrl(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressDeniedError('URL_NOT_ALLOWED', 'The outbound URL is not a valid absolute URL.');
  }

  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new EgressDeniedError(
      'URL_NOT_ALLOWED',
      'The outbound URL must be HTTPS on the default port without credentials or a fragment.',
    );
  }
  if (!allowedHosts.includes(hostname)) {
    throw new EgressDeniedError('HOST_NOT_ALLOWED', 'The outbound host is not on the allowlist.');
  }
  return url;
}

const defaultAddressLookup: AddressLookup = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Resolves an allowlisted hostname and returns the address the connection will
 * be pinned to. Every answer must be public, not merely the selected one, so a
 * DNS rebinding answer that mixes one public and one internal address fails.
 */
export async function resolvePublicAddress(
  hostname: string,
  lookup: AddressLookup = defaultAddressLookup,
): Promise<{ address: string; family: number }> {
  const addresses = await lookup(hostname);
  if (addresses.length === 0) {
    throw new EgressDeniedError('HOST_UNRESOLVED', 'The outbound host has no usable address.');
  }
  if (addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new EgressDeniedError(
      'PRIVATE_ADDRESS',
      'The outbound host did not resolve exclusively to public addresses.',
    );
  }
  const selected = addresses[0];
  if (selected === undefined) {
    throw new EgressDeniedError('HOST_UNRESOLVED', 'The outbound host has no usable address.');
  }
  return selected;
}

/** Performs one guarded HTTPS request and buffers a size-bounded response. */
export async function requestBoundedHttps(options: EgressRequest): Promise<EgressResponse> {
  const url = assertAllowedEgressUrl(options.url, options.allowedHosts);
  const target = await resolvePublicAddress(url.hostname, options.lookup);
  const body =
    options.body === undefined
      ? undefined
      : Buffer.isBuffer(options.body)
        ? options.body
        : Buffer.from(options.body, 'utf8');

  return new Promise<EgressResponse>((resolve, reject) => {
    const outbound = request(
      {
        family: target.family,
        headers: {
          ...options.headers,
          host: url.host,
          ...(body === undefined ? {} : { 'content-length': String(body.byteLength) }),
        },
        hostname: target.address,
        method: options.method,
        path: `${url.pathname}${url.search}`,
        port: 443,
        rejectUnauthorized: true,
        servername: url.hostname,
        signal: AbortSignal.timeout(options.timeoutMs),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteCount = 0;
        response.on('data', (chunk: Buffer) => {
          byteCount += chunk.length;
          if (byteCount > options.maxResponseBytes) {
            response.destroy(
              new EgressDeniedError(
                'RESPONSE_TOO_LARGE',
                'The outbound response exceeded its size limit.',
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    outbound.once('error', reject);
    if (body !== undefined) {
      outbound.write(body);
    }
    outbound.end();
  });
}
