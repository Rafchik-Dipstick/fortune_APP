import { type KeyObject } from 'node:crypto';

import { type AuthenticationEnvironment } from '../config/environment.js';
import {
  fetchBoundedCertificate,
  validateAllowedCertificateUrl,
  validateGameCenterCertificateChain,
  type RemoteCertificateResponse,
} from './safe-remote-certificate.js';

export interface GameCenterPublicKeyProvider {
  getPublicKey: (url: string, now: Date) => Promise<KeyObject>;
}

interface CachedKey {
  expiresAt: number;
  publicKey: KeyObject;
}

export interface GameCenterPublicKeyProviderDependencies {
  fetchCertificate?: (
    url: string,
    allowedHosts: readonly string[],
  ) => Promise<RemoteCertificateResponse>;
  validateCertificate?: (
    bytes: Buffer,
    allowedIssuerHosts: readonly string[],
    now: Date,
  ) => Promise<{ expiresAt: Date; publicKey: KeyObject }>;
}

export class CachedGameCenterPublicKeyProvider implements GameCenterPublicKeyProvider {
  private readonly cache = new Map<string, CachedKey>();
  private readonly pending = new Map<string, Promise<KeyObject>>();
  private readonly fetchCertificate: NonNullable<
    GameCenterPublicKeyProviderDependencies['fetchCertificate']
  >;
  private readonly validateCertificate: NonNullable<
    GameCenterPublicKeyProviderDependencies['validateCertificate']
  >;

  constructor(
    private readonly environment: AuthenticationEnvironment,
    dependencies: GameCenterPublicKeyProviderDependencies = {},
  ) {
    this.fetchCertificate = dependencies.fetchCertificate ?? fetchBoundedCertificate;
    this.validateCertificate =
      dependencies.validateCertificate ?? validateGameCenterCertificateChain;
  }

  async getPublicKey(rawUrl: string, now: Date): Promise<KeyObject> {
    const url = validateAllowedCertificateUrl(
      rawUrl,
      this.environment.gameCenterPublicKeyHosts,
    ).toString();
    const cached = this.cache.get(url);
    if (cached !== undefined && cached.expiresAt > now.getTime()) {
      return cached.publicKey;
    }

    const existing = this.pending.get(url);
    if (existing !== undefined) {
      return existing;
    }

    const pending = this.load(url, now).finally(() => {
      this.pending.delete(url);
    });
    this.pending.set(url, pending);
    return pending;
  }

  private async load(url: string, now: Date): Promise<KeyObject> {
    const response = await this.fetchCertificate(url, this.environment.gameCenterPublicKeyHosts);
    const validated = await this.validateCertificate(
      response.bytes,
      this.environment.gameCenterCertificateHosts,
      now,
    );
    const cacheExpiresAt = Math.min(
      validated.expiresAt.getTime(),
      now.getTime() + response.cacheMaxAgeSeconds * 1_000,
    );
    if (cacheExpiresAt > now.getTime()) {
      this.cache.set(url, { publicKey: validated.publicKey, expiresAt: cacheExpiresAt });
    }
    return validated.publicKey;
  }
}
