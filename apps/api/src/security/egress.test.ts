import { describe, expect, it, vi } from 'vitest';

import {
  type AddressLookup,
  EgressDeniedError,
  assertAllowedEgressUrl,
  isPublicNetworkAddress,
  requestBoundedHttps,
  resolvePublicAddress,
} from './egress.js';

const allowedHosts = ['static.gc.apple.com'];

describe('outbound egress guard', () => {
  it.each([
    ['17.0.0.1', true],
    ['8.8.8.8', true],
    ['2606:4700:4700::1111', true],
    ['0.0.0.0', false],
    ['10.0.0.1', false],
    ['100.64.0.1', false],
    ['127.0.0.1', false],
    ['169.254.169.254', false],
    ['172.16.0.1', false],
    ['192.168.0.1', false],
    ['198.18.0.1', false],
    ['198.51.100.1', false],
    ['203.0.113.1', false],
    ['239.0.0.1', false],
    ['::', false],
    ['::1', false],
    ['::ffff:127.0.0.1', false],
    ['fc00::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['not-an-address', false],
  ])('classifies %s as publicly routable = %s', (address, expected) => {
    expect(isPublicNetworkAddress(address)).toBe(expected);
  });

  it('accepts only an exact allowlisted HTTPS origin', () => {
    expect(
      assertAllowedEgressUrl(
        'https://static.gc.apple.com/public-key/current.cer?version=1',
        allowedHosts,
      ).hostname,
    ).toBe('static.gc.apple.com');
    expect(
      assertAllowedEgressUrl('https://STATIC.GC.APPLE.COM/key.cer', allowedHosts).hostname,
    ).toBe('static.gc.apple.com');
  });

  it.each([
    ['plaintext', 'http://static.gc.apple.com/key.cer'],
    ['a non-default port', 'https://static.gc.apple.com:8443/key.cer'],
    ['embedded credentials', 'https://user:secret@static.gc.apple.com/key.cer'],
    ['a username only', 'https://user@static.gc.apple.com/key.cer'],
    ['a fragment', 'https://static.gc.apple.com/key.cer#f'],
    ['a suffix lookalike host', 'https://static.gc.apple.com.attacker.example/key.cer'],
    ['a prefix lookalike host', 'https://attacker-static.gc.apple.com/key.cer'],
    ['a bare IP literal', 'https://169.254.169.254/latest/meta-data/'],
    ['a relative reference', '/public-key/current.cer'],
    ['a non-HTTP scheme', 'file:///etc/passwd'],
  ])('denies %s', (_description, url) => {
    expect(() => assertAllowedEgressUrl(url, allowedHosts)).toThrow(EgressDeniedError);
  });

  it('denies a disallowed host before performing any DNS lookup', async () => {
    const lookup = vi.fn<AddressLookup>();

    await expect(
      requestBoundedHttps({
        allowedHosts,
        lookup,
        maxResponseBytes: 1_024,
        method: 'GET',
        timeoutMs: 1_000,
        url: 'https://attacker.example/probe',
      }),
    ).rejects.toMatchObject({ reason: 'HOST_NOT_ALLOWED' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('denies an allowlisted host that resolves to a private address', async () => {
    const lookup: AddressLookup = () =>
      Promise.resolve([{ address: '169.254.169.254', family: 4 }]);

    await expect(resolvePublicAddress('static.gc.apple.com', lookup)).rejects.toMatchObject({
      reason: 'PRIVATE_ADDRESS',
    });
  });

  it('denies a rebinding answer that mixes a public and an internal address', async () => {
    const lookup: AddressLookup = () =>
      Promise.resolve([
        { address: '17.0.0.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);

    await expect(resolvePublicAddress('static.gc.apple.com', lookup)).rejects.toMatchObject({
      reason: 'PRIVATE_ADDRESS',
    });
  });

  it('denies a host with no address at all', async () => {
    await expect(
      resolvePublicAddress('static.gc.apple.com', () => Promise.resolve([])),
    ).rejects.toMatchObject({ reason: 'HOST_UNRESOLVED' });
  });

  it('pins the connection to the first validated public address', async () => {
    await expect(
      resolvePublicAddress('static.gc.apple.com', () =>
        Promise.resolve([
          { address: '17.0.0.1', family: 4 },
          { address: '17.0.0.2', family: 4 },
        ]),
      ),
    ).resolves.toEqual({ address: '17.0.0.1', family: 4 });
  });

  it('never opens a socket for a request whose host resolves internally', async () => {
    const lookup: AddressLookup = () => Promise.resolve([{ address: '10.0.0.5', family: 4 }]);

    await expect(
      requestBoundedHttps({
        allowedHosts,
        lookup,
        maxResponseBytes: 1_024,
        method: 'GET',
        timeoutMs: 1_000,
        url: 'https://static.gc.apple.com/key.cer',
      }),
    ).rejects.toBeInstanceOf(EgressDeniedError);
  });
});
