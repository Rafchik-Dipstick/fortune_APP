import { generateKeyPairSync } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EgressModule from '../security/egress.js';
import { type EgressRequest, type EgressResponse } from '../security/egress.js';

const requestBoundedHttps = vi.hoisted(() =>
  vi.fn<(options: EgressRequest) => Promise<EgressResponse>>(),
);

vi.mock('../security/egress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof EgressModule>()),
  requestBoundedHttps,
}));

const { AppleAppStoreServerClient } = await import('./app-store-server-client.js');

const signingKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();

const credentials = { issuerId: 'issuer-id', keyId: 'KEYID12345', privateKeyPem: signingKey };

function respond(statusCode: number, body: unknown): EgressResponse {
  return {
    body: Buffer.from(JSON.stringify(body), 'utf8'),
    headers: {},
    statusCode,
  };
}

/**
 * These exercise the real App Store Server Library request path against the
 * egress-guarded transport override, so the assumption that the library only
 * consumes `ok`, `status`, and `json()` is proven rather than asserted.
 */
describe('egress-guarded App Store Server API client', () => {
  beforeEach(() => {
    requestBoundedHttps.mockReset();
  });

  it('sends production traffic only to the allowlisted production host', async () => {
    requestBoundedHttps.mockResolvedValueOnce(
      respond(200, { signedTransactionInfo: 'signed.jws' }),
    );
    const client = new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'PRODUCTION', {
      timeoutMs: 4_000,
    });

    await expect(client.getTransactionInfo('2000000000000001')).resolves.toBe('signed.jws');

    const call = requestBoundedHttps.mock.calls[0]?.[0];
    expect(call?.allowedHosts).toEqual(['api.storekit.apple.com']);
    expect(call?.url).toBe(
      'https://api.storekit.apple.com/inApps/v1/transactions/2000000000000001',
    );
    expect(call?.method).toBe('GET');
    expect(call?.timeoutMs).toBe(4_000);
    expect(new URL(call?.url ?? '').hostname).toBe(call?.allowedHosts[0]);
  });

  it('sends sandbox traffic only to the allowlisted sandbox host', async () => {
    requestBoundedHttps.mockResolvedValueOnce(
      respond(200, { signedTransactionInfo: 'signed.jws' }),
    );
    const client = new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'SANDBOX', {
      timeoutMs: 4_000,
    });

    await client.getTransactionInfo('2000000000000002');

    expect(requestBoundedHttps.mock.calls[0]?.[0].allowedHosts).toEqual([
      'api.storekit-sandbox.apple.com',
    ]);
  });

  it('carries the signed bearer authorization without leaking the signing key', async () => {
    requestBoundedHttps.mockResolvedValueOnce(
      respond(200, { signedTransactionInfo: 'signed.jws' }),
    );
    const client = new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'SANDBOX', {
      timeoutMs: 4_000,
    });

    await client.getTransactionInfo('2000000000000003');

    const headers = requestBoundedHttps.mock.calls[0]?.[0].headers ?? {};
    expect(headers['Authorization']).toMatch(/^Bearer ey/u);
    expect(JSON.stringify(headers)).not.toContain('PRIVATE KEY');
  });

  it('maps a 404 to an absent transaction rather than an error', async () => {
    requestBoundedHttps.mockResolvedValueOnce(respond(404, { errorCode: 4040010 }));
    const client = new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'SANDBOX', {
      timeoutMs: 4_000,
    });

    await expect(client.getTransactionInfo('2000000000000004')).resolves.toBeNull();
  });

  it('propagates other Apple failures instead of treating them as success', async () => {
    requestBoundedHttps.mockResolvedValueOnce(respond(500, { errorCode: 5000000 }));
    const client = new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'SANDBOX', {
      timeoutMs: 4_000,
    });

    await expect(client.getTransactionInfo('2000000000000005')).rejects.toThrow();
  });

  it('posts consumption information through the same guarded transport', async () => {
    requestBoundedHttps.mockResolvedValueOnce(respond(202, {}));
    const client = new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'SANDBOX', {
      timeoutMs: 4_000,
    });

    await client.send('2000000000000006', {
      customerConsented: true,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: false,
    });

    const call = requestBoundedHttps.mock.calls[0]?.[0];
    expect(call?.method).toBe('PUT');
    expect(call?.allowedHosts).toEqual(['api.storekit-sandbox.apple.com']);
    expect(String(call?.body)).not.toContain('PRIVATE KEY');
  });

  it('refuses to construct a server client for the Xcode environment', () => {
    expect(
      () =>
        new AppleAppStoreServerClient(credentials, 'app.fortuneness', 'XCODE', {
          timeoutMs: 4_000,
        }),
    ).toThrow(/Xcode/u);
  });
});
