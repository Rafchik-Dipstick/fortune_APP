import { AppStoreServerAPIClient } from '@apple/app-store-server-library';
import { describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import {
  appStoreServerApiHosts,
  describeOutboundDestinations,
  listAllowedEgressHosts,
} from './egress-inventory.js';

const withCommerce = (
  environment: ReturnType<typeof createTestApiEnvironment>,
  overrides: Partial<ReturnType<typeof createTestApiEnvironment>['commerce']>,
): ReturnType<typeof createTestApiEnvironment> =>
  createTestApiEnvironment({ commerce: { ...environment.commerce, ...overrides } });

describe('declared outbound destinations', () => {
  it('lists only Apple identity, Apple commerce, and revocation hosts by default', () => {
    const environment = createTestApiEnvironment();

    expect(listAllowedEgressHosts(environment)).toEqual(['appleid.apple.com', 'ocsp.apple.com']);
  });

  it('adds the App Store Server API host only when credentials exist for a server environment', () => {
    const base = createTestApiEnvironment();
    const credentials = {
      issuerId: 'issuer',
      keyId: 'key',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----',
    };

    expect(
      listAllowedEgressHosts(
        withCommerce(base, { appStoreServerApi: credentials, environment: 'SANDBOX' }),
      ),
    ).toContain('api.storekit-sandbox.apple.com');
    expect(
      listAllowedEgressHosts(
        withCommerce(base, { appStoreServerApi: credentials, environment: 'PRODUCTION' }),
      ),
    ).toContain('api.storekit.apple.com');
    expect(
      listAllowedEgressHosts(
        withCommerce(base, { appStoreServerApi: credentials, environment: 'XCODE' }),
      ),
    ).not.toContain('api.storekit.apple.com');
    expect(listAllowedEgressHosts(withCommerce(base, { appStoreServerApi: null }))).not.toContain(
      'api.storekit-sandbox.apple.com',
    );
  });

  it('adds the error-reporting ingest host only when a DSN is configured', () => {
    const base = createTestApiEnvironment();

    expect(listAllowedEgressHosts(base)).not.toContain('ingest.example.com');
    expect(
      listAllowedEgressHosts(
        createTestApiEnvironment({
          observability: {
            ...base.observability,
            errorReporting: {
              envelopeUrl: 'https://ingest.example.com/api/42/envelope/',
              host: 'ingest.example.com',
              projectId: '42',
              publicKey: 'public',
            },
          },
        }),
      ),
    ).toContain('ingest.example.com');
  });

  it('records the enforcement class for every destination', () => {
    const destinations = describeOutboundDestinations(createTestApiEnvironment());

    expect(destinations.every((entry) => entry.hosts.length > 0)).toBe(true);
    expect(destinations).toContainEqual({
      enforcement: 'FIXED_ORIGIN',
      hosts: ['appleid.apple.com'],
      purpose: 'Sign in with Apple JSON Web Key Set',
      scheme: 'https',
    });
    expect(destinations.filter((entry) => entry.enforcement === 'PINNED_TRUST')).toEqual([
      {
        enforcement: 'PINNED_TRUST',
        hosts: ['ocsp.apple.com'],
        purpose: 'Online revocation status for Apple JWS signing certificates',
        scheme: 'http',
      },
    ]);
  });

  it('matches the base URLs Apple’s client would use, so a vendor change cannot slip past', () => {
    // The library keeps these as private statics; reading them at runtime is
    // the only way to prove the allowlist still points where calls go.
    const clientConstants = AppStoreServerAPIClient as unknown as {
      PRODUCTION_URL: string;
      SANDBOX_URL: string;
    };

    expect(new URL(clientConstants.PRODUCTION_URL).hostname).toBe(
      appStoreServerApiHosts.PRODUCTION,
    );
    expect(new URL(clientConstants.SANDBOX_URL).hostname).toBe(appStoreServerApiHosts.SANDBOX);
  });
});
