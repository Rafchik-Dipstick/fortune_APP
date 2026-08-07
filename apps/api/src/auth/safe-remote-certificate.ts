import { X509Certificate, type KeyObject } from 'node:crypto';
import { rootCertificates } from 'node:tls';

import {
  type AddressLookup,
  assertAllowedEgressUrl,
  isPublicNetworkAddress,
  requestBoundedHttps,
} from '../security/egress.js';

const maximumCertificateBytes = 64 * 1024;
const requestTimeoutMs = 3_000;
const maximumChainDepth = 4;
const codeSigningExtendedKeyUsage = '1.3.6.1.5.5.7.3.3';

export interface RemoteCertificateResponse {
  bytes: Buffer;
  cacheMaxAgeSeconds: number;
}

export { type AddressLookup, isPublicNetworkAddress };

/**
 * Certificate URLs are ordinary guarded egress; this alias keeps the
 * Game Center call sites reading in their own vocabulary while the SSRF
 * controls live in one place.
 */
export function validateAllowedCertificateUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  return assertAllowedEgressUrl(rawUrl, allowedHosts);
}

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
  addressLookup?: AddressLookup,
): Promise<RemoteCertificateResponse> {
  const response = await requestBoundedHttps({
    allowedHosts,
    maxResponseBytes: maximumCertificateBytes,
    method: 'GET',
    timeoutMs: requestTimeoutMs,
    url: rawUrl,
    ...(addressLookup === undefined ? {} : { lookup: addressLookup }),
  });

  // A redirect is a non-success status here. The guard never follows one, so
  // a 3xx can never move the fetch off the allowlisted host.
  if (response.statusCode !== 200) {
    throw new Error('Remote certificate returned a non-success status.');
  }
  if (response.body.byteLength === 0) {
    throw new Error('Remote certificate response was empty.');
  }

  const cacheControl = response.headers['cache-control'];
  return {
    bytes: response.body,
    cacheMaxAgeSeconds: parseCacheMaxAge(
      Array.isArray(cacheControl) ? cacheControl[0] : cacheControl,
    ),
  };
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
