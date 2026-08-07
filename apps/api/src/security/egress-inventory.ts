import { type ApiEnvironment } from '../config/environment.js';

/**
 * The complete declared outbound surface of the API process.
 *
 * Phase 13 requires outbound-request restrictions, which means two things: a
 * guard that enforces an allowlist (`./egress.js`) and a written statement of
 * every destination the process is permitted to reach at all. This module is
 * the second half. A test asserts the inventory matches the hosts the code
 * actually configures, so adding a destination without recording it fails the
 * build, and the deployment runbook can be diffed against reality.
 */

export type EgressEnforcement =
  | 'GUARDED' // Routed through requestBoundedHttps: allowlist, public IP, bounds.
  | 'PINNED_TRUST'; // Destination derives from Apple-signed data validated against pinned roots.

export interface OutboundDestination {
  enforcement: EgressEnforcement;
  hosts: readonly string[];
  purpose: string;
  scheme: 'https' | 'http';
}

export const appStoreServerApiHosts = {
  PRODUCTION: 'api.storekit.apple.com',
  SANDBOX: 'api.storekit-sandbox.apple.com',
  XCODE: null,
} as const satisfies Record<ApiEnvironment['commerce']['environment'], string | null>;

/** Apple's OCSP responder, reached only from certificates already chained to a pinned Apple root. */
export const appleOcspHost = 'ocsp.apple.com';

export function describeOutboundDestinations(
  environment: ApiEnvironment,
): readonly OutboundDestination[] {
  const destinations: OutboundDestination[] = [
    {
      enforcement: 'GUARDED',
      hosts: environment.authentication.gameCenterPublicKeyHosts,
      purpose: 'Game Center signing certificate named by an untrusted client proof',
      scheme: 'https',
    },
    {
      enforcement: 'GUARDED',
      hosts: environment.authentication.gameCenterCertificateHosts,
      purpose: 'Issuer certificates while building the Game Center chain',
      scheme: 'https',
    },
  ];

  const appStoreHost = appStoreServerApiHosts[environment.commerce.environment];
  if (appStoreHost !== null && environment.commerce.appStoreServerApi !== null) {
    destinations.push({
      enforcement: 'GUARDED',
      hosts: [appStoreHost],
      purpose: 'App Store Server API reconciliation reads and consumption information',
      scheme: 'https',
    });
  }

  if (environment.observability.errorReporting !== null) {
    destinations.push({
      enforcement: 'GUARDED',
      hosts: [environment.observability.errorReporting.host],
      purpose: 'Scrubbed error reports for the declared deployment environment',
      scheme: 'https',
    });
  }

  destinations.push({
    enforcement: 'PINNED_TRUST',
    hosts: [appleOcspHost],
    purpose: 'Online revocation status for Apple JWS signing certificates',
    scheme: 'http',
  });

  return destinations;
}

/** Flattens the inventory into the host set an egress audit should expect. */
export function listAllowedEgressHosts(environment: ApiEnvironment): readonly string[] {
  return [
    ...new Set(describeOutboundDestinations(environment).flatMap((entry) => entry.hosts)),
  ].sort();
}
