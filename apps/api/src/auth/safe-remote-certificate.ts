import { X509Certificate, type KeyObject } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { rootCertificates } from 'node:tls';

const maximumCertificateBytes = 64 * 1024;
const requestTimeoutMs = 3_000;
const maximumChainDepth = 4;
const codeSigningExtendedKeyUsage = '1.3.6.1.5.5.7.3.3';

export interface RemoteCertificateResponse {
  bytes: Buffer;
  cacheMaxAgeSeconds: number;
}

export type AddressLookup = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

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

export function validateAllowedCertificateUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    !allowedHosts.includes(hostname)
  ) {
    throw new Error('Remote certificate URL is not allowed.');
  }
  return url;
}

const defaultAddressLookup: AddressLookup = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

function parseCacheMaxAge(cacheControl: string | undefined): number {
  const match = /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/iu.exec(cacheControl ?? '');
  if (match?.[1] === undefined) {
    return 0;
  }
  return Math.min(Number(match[1]), 86_400);
}

export async function fetchBoundedCertificate(
  rawUrl: string,
  allowedHosts: readonly string[],
  addressLookup: AddressLookup = defaultAddressLookup,
): Promise<RemoteCertificateResponse> {
  const url = validateAllowedCertificateUrl(rawUrl, allowedHosts);
  const addresses = await addressLookup(url.hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new Error('Remote certificate host did not resolve exclusively to public addresses.');
  }
  const selectedAddress = addresses[0];
  if (selectedAddress === undefined) {
    throw new Error('Remote certificate host has no usable address.');
  }

  return new Promise((resolve, reject) => {
    const certificateRequest = request(
      {
        hostname: selectedAddress.address,
        family: selectedAddress.family,
        port: 443,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host },
        servername: url.hostname,
        rejectUnauthorized: true,
        signal: AbortSignal.timeout(requestTimeoutMs),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error('Remote certificate returned a non-success status.'));
          return;
        }

        const chunks: Buffer[] = [];
        let byteCount = 0;
        response.on('data', (chunk: Buffer) => {
          byteCount += chunk.length;
          if (byteCount > maximumCertificateBytes) {
            response.destroy(new Error('Remote certificate exceeded the response limit.'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          if (byteCount === 0) {
            reject(new Error('Remote certificate response was empty.'));
            return;
          }
          resolve({
            bytes: Buffer.concat(chunks),
            cacheMaxAgeSeconds: parseCacheMaxAge(response.headers['cache-control']),
          });
        });
      },
    );
    certificateRequest.once('error', reject);
    certificateRequest.end();
  });
}

function isCertificateValidAt(certificate: X509Certificate, now: Date): boolean {
  return certificate.validFromDate <= now && certificate.validToDate >= now;
}

function getIssuerUrl(certificate: X509Certificate): string | undefined {
  const line = (certificate.infoAccess ?? '')
    .split('\n')
    .find((candidate) => candidate.startsWith('CA Issuers - URI:'));
  if (line === undefined) {
    return undefined;
  }
  const encodedValue = line.slice('CA Issuers - URI:'.length);
  return encodedValue.startsWith('"') ? (JSON.parse(encodedValue) as string) : encodedValue;
}

const trustedRoots = rootCertificates.map((pem) => new X509Certificate(pem));

export async function validateGameCenterCertificateChain(
  leafBytes: Buffer,
  allowedIssuerHosts: readonly string[],
  now: Date,
  fetchCertificate: typeof fetchBoundedCertificate = fetchBoundedCertificate,
): Promise<{ expiresAt: Date; publicKey: KeyObject }> {
  const leaf = new X509Certificate(leafBytes);
  if (
    leaf.ca ||
    !isCertificateValidAt(leaf, now) ||
    !leaf.subject.split('\n').includes('O=Apple Inc.') ||
    !leaf.keyUsage.includes(codeSigningExtendedKeyUsage) ||
    leaf.publicKey.asymmetricKeyType !== 'rsa'
  ) {
    throw new Error(
      'Game Center signing certificate is not an eligible Apple RSA code-signing leaf.',
    );
  }

  let current = leaf;
  const fingerprints = new Set<string>([leaf.fingerprint256]);
  for (let depth = 0; depth < maximumChainDepth; depth += 1) {
    const trustedIssuer = trustedRoots.find(
      (root) =>
        root.subject === current.issuer &&
        isCertificateValidAt(root, now) &&
        current.checkIssued(root) &&
        current.verify(root.publicKey),
    );
    if (trustedIssuer !== undefined) {
      return { publicKey: leaf.publicKey, expiresAt: leaf.validToDate };
    }

    const issuerUrlValue = getIssuerUrl(current);
    if (issuerUrlValue === undefined) {
      throw new Error('Certificate chain did not reach a trusted root.');
    }
    const issuerUrl = new URL(issuerUrlValue);
    issuerUrl.protocol = 'https:';
    const issuerResponse = await fetchCertificate(issuerUrl.toString(), allowedIssuerHosts);
    const issuer = new X509Certificate(issuerResponse.bytes);
    if (
      !issuer.ca ||
      !isCertificateValidAt(issuer, now) ||
      !current.checkIssued(issuer) ||
      !current.verify(issuer.publicKey) ||
      fingerprints.has(issuer.fingerprint256)
    ) {
      throw new Error('Certificate chain contains an invalid issuer.');
    }
    fingerprints.add(issuer.fingerprint256);
    current = issuer;
  }

  throw new Error('Certificate chain exceeded the maximum depth.');
}
