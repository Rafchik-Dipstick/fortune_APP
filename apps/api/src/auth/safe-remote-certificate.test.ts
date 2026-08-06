import { describe, expect, it } from 'vitest';

import {
  isPublicNetworkAddress,
  validateAllowedCertificateUrl,
  validateGameCenterCertificateChain,
} from './safe-remote-certificate.js';

describe('remote certificate boundary', () => {
  it.each([
    ['17.0.0.1', true],
    ['8.8.8.8', true],
    ['10.0.0.1', false],
    ['100.64.0.1', false],
    ['127.0.0.1', false],
    ['169.254.1.1', false],
    ['172.16.0.1', false],
    ['192.168.0.1', false],
    ['198.51.100.1', false],
    ['203.0.113.1', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['2001:db8::1', false],
    ['2606:4700:4700::1111', true],
  ])('classifies %s public=%s', (address, expected) => {
    expect(isPublicNetworkAddress(address)).toBe(expected);
  });

  it('allows only exact HTTPS hosts without credentials, ports, or fragments', () => {
    const allowedHosts = ['static.gc.apple.com'];
    expect(
      validateAllowedCertificateUrl(
        'https://static.gc.apple.com/public-key/current.cer?version=1',
        allowedHosts,
      ).hostname,
    ).toBe('static.gc.apple.com');

    for (const url of [
      'http://static.gc.apple.com/key.cer',
      'https://static.gc.apple.com:444/key.cer',
      'https://user@static.gc.apple.com/key.cer',
      'https://static.gc.apple.com.attacker.example/key.cer',
      'https://static.gc.apple.com/key.cer#fragment',
    ]) {
      expect(() => validateAllowedCertificateUrl(url, allowedHosts)).toThrow();
    }
  });

  it('rejects malformed certificate bytes before trusting a public key', async () => {
    await expect(
      validateGameCenterCertificateChain(
        Buffer.from('not a certificate'),
        ['cacerts.digicert.com'],
        new Date(),
      ),
    ).rejects.toThrow();
  });
});
